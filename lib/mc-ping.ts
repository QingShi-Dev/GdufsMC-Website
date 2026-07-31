/**
 * 原生 Node.js 实现的 Minecraft Server List Ping 协议。
 *
 * 参考 https://wiki.vg/Server_List_Ping
 *
 * 协议流程：
 *   1) 客户端发 Handshake 包（packet id 0x00，next_state = 1 表示 status）
 *   2) 客户端发 Status Request 包（packet id 0x00，payload 为空）
 *   3) 服务端返回 Status Response（packet id 0x00 + JSON 字符串）
 *   4) 客户端可发 Ping 包（payload 为 long），服务端回 Pong（用于测延迟；这里我们直接用 TCP 耗时即可）
 *
 * 所有整型字段采用大端序，VarInt 采用 7 位一组、低位在前的编码。
 */

import { Socket, isIP } from "node:net";

/** MC 1.21.x 的协议号；这里用于 handshake 协商，服务器回的内容仍以服务端实际版本为准 */
export const PROTOCOL_VERSION = 770;

export interface MCPingResponse {
  version: { name: string; protocol: number } | null;
  players: {
    max: number;
    online: number;
    sample?: { name: string; id?: string }[];
  } | null;
  description: unknown;
  favicon?: string;
}

export interface MCPingResult {
  online: true;
  latencyMs: number;
  response: MCPingResponse;
}

export interface MCPingFailure {
  online: false;
  error: string;
}

/* -------------------- VarInt 编码 / 解码 -------------------- */

export function getVarIntSize(value: number): number {
  let size = 0;
  let v = value >>> 0;
  while (true) {
    size += 1;
    if ((v & ~0x7f) === 0) return size;
    v >>>= 7;
  }
}

export function writeVarInt(value: number): Buffer {
  const v = value >>> 0;
  const bytes: number[] = [];
  let x = v;
  while (true) {
    if ((x & ~0x7f) === 0) {
      bytes.push(x);
      return Buffer.from(bytes);
    }
    bytes.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
}

export function readVarInt(
    buf: Buffer,
    offset: number
): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let pos = offset;
  let byte: number;
  do {
    if (pos >= buf.length) {
      throw new Error("VarInt 读取越界");
    }
    const b = buf[pos];
    if (b === undefined) {
      throw new Error("VarInt 读取越界");
    }
    pos++;
    byte = b;
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
    if (size > 5) {
      throw new Error("VarInt 过长");
    }
  } while ((byte & 0x80) !== 0);
  return { value: value >>> 0, size };
}

/* -------------------- 高层写入 -------------------- */

export function writeString(str: string): Buffer {
  const utf8 = Buffer.from(str, "utf8");
  return Buffer.concat([writeVarInt(utf8.length), utf8]);
}

export function writeUShort(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value & 0xffff, 0);
  return buf;
}

function writePacket(packetId: number, payload: Buffer): Buffer {
  return Buffer.concat([writeVarInt(packetId), payload]);
}

function framePacket(packet: Buffer): Buffer {
  return Buffer.concat([writeVarInt(packet.length), packet]);
}

/* -------------------- DNS 解析（支持 SRV） -------------------- */

async function resolveHost(
    host: string,
    port: number,
    enableSRV: boolean
): Promise<{ host: string; port: number }> {
  // IP 字面量直接返回（用 net.isIP 准确判断 IPv4/IPv6）
  if (isIP(host) !== 0) {
    return { host, port };
  }

  if (enableSRV) {
    try {
      // 形如 _minecraft._tcp.example.com
      const srvName = `_minecraft._tcp.${host}`;
      const dns = await import("node:dns");
      const srvs = await dns.promises.resolveSrv(srvName);
      if (srvs.length > 0) {
        // length > 0 已检查, [0] 必存在; 用 ! 让 noUncheckedIndexedAccess 通过
        const first = srvs[0]!;
        return { host: first.name, port: first.port };
      }
    } catch {
      // 没有 SRV 记录就 fallback 到 A 记录
    }
  }

  try {
    const dns = await import("node:dns");
    const addrs = await dns.promises.resolve4(host);
    if (addrs.length > 0) return { host: addrs[0]!, port };
  } catch {
    // fallback: 用 host 本身
  }
  return { host, port };
}

/* -------------------- 真正发包 -------------------- */

export interface QueryOptions {
  timeoutMs?: number;
  enableSRV?: boolean;
}

export async function queryMCServer(
    host: string,
    port = 25565,
    opts: QueryOptions = {}
): Promise<MCPingResult | MCPingFailure> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const enableSRV = opts.enableSRV ?? true;

  const resolved = await resolveHost(host, port, enableSRV);

  // MC 协议里 IPv6 字面量要写成 "[::1]"（host 字段是字符串，port 单独传）
  const handshakeHost = isIP(resolved.host) === 6 ? `[${resolved.host}]` : resolved.host;

  // 计时点放在 socket 构造之前，DNS 解析的耗时不算 latency
  // （mc-status 会拿这个 latency 展示给玩家，必须是纯网络耗时）
  const socket = new Socket();
  socket.setNoDelay(true);
  let start = 0; // 在 socket.connect 之后同步打点（DNS 已完成）

  const cleanup = () => {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  };

  return new Promise<MCPingResult | MCPingFailure>((resolve) => {
    let finished = false;
    const finish = (v: MCPingResult | MCPingFailure) => {
      if (finished) return;
      finished = true;
      cleanup();
      clearTimeout(timer);
      resolve(v);
    };

    const timer = setTimeout(() => {
      finish({ online: false, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    socket.once("error", (err) => {
      finish({ online: false, error: err.message });
    });

    // 接收缓冲 + 状态机
    let recvBuf: Buffer = Buffer.alloc(0);
    // -1 = 等待读 packet length；>=0 = 等待攒够的剩余字节数
    let packetLen = -1;
    let packetBuf: Buffer = Buffer.alloc(0);

    /** 读一个 packet 并尝试解析为 status response；解析成功就 finish。 */
    const tryParseOnePacket = (): void => {
      // 1) 读 packet length VarInt
      if (packetLen === -1) {
        if (recvBuf.length < 1) return;
        // peek 看 VarInt 边界
        let need = 0;
        while (need < Math.min(5, recvBuf.length)) {
          need += 1;
          const peek = recvBuf[need - 1];
          if (peek === undefined) break; // 边界内必有值, 这里只是让 TS 通过
          if ((peek & 0x80) === 0) break;
        }
        if (recvBuf.length < need) return; // 数据不够，下次再说
        const { value, size } = readVarInt(recvBuf, 0);
        packetLen = value;
        packetBuf = Buffer.alloc(0);
        recvBuf = recvBuf.subarray(size);
      }

      // 2) 攒够 packetLen 字节
      if (packetBuf.length + recvBuf.length < packetLen) {
        packetBuf = Buffer.concat([packetBuf, recvBuf]);
        recvBuf = Buffer.alloc(0);
        return;
      }
      const remaining = packetLen - packetBuf.length;
      packetBuf = Buffer.concat([packetBuf, recvBuf.subarray(0, remaining)]);
      recvBuf = recvBuf.subarray(remaining);
      const fullPacket = packetBuf;
      packetBuf = Buffer.alloc(0);
      packetLen = -1;

      // 3) 解析 packet：[packet id VarInt][json length VarInt][json bytes]
      //    packet id 不为 0 就跳过（兼容 Set Compression 等中间包）
      try {
        if (fullPacket.length < 1) {
          // 长度为 0 的包无效，继续等下一个
          return;
        }
        const { value: packetId, size: pidSize } = readVarInt(fullPacket, 0);
        if (packetId !== 0x00) {
          // 忽略非 status-response 的包（ping pong 等），继续读下一个
          return;
        }
        const { value: jsonLen, size: lenSize } = readVarInt(
            fullPacket,
            pidSize
        );
        const jsonStart = pidSize + lenSize;
        if (jsonStart + jsonLen > fullPacket.length) {
          // 协议层说不应该截断，但保险起见当作格式错误
          finish({ online: false, error: "packet truncated" });
          return;
        }
        const jsonStr = fullPacket
            .subarray(jsonStart, jsonStart + jsonLen)
            .toString("utf8");
        const parsed = JSON.parse(jsonStr) as MCPingResponse;
        const latencyMs = Date.now() - start;
        finish({ online: true, latencyMs, response: parsed });
      } catch (e) {
        finish({
          online: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    socket.on("data", (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      // 一个 data 事件可能包含多个 packet，循环解析
      // 防护：最多循环 64 次避免极端情况下的死循环
      for (let i = 0; i < 64; i++) {
        if (finished) return;
        const before = recvBuf.length;
        tryParseOnePacket();
        // 两个 break 覆盖两种"无进展"：
        //   1) packetLen === -1 → 没在攒包、buffer 也没消耗，需要更多数据
        //   2) packetLen !== -1 → 正在攒某个包，但当前 buffer 喂不进去它
        // 合并为一行难读，刻意拆开
        if (recvBuf.length === before && packetLen === -1) {
          break; // 情形 1
        }
        if (recvBuf.length === before) {
          break; // 情形 2
        }
      }
    });

    // 连接成功后立即发握手 + 状态请求（关键修复：之前在 data 里等服务器先说话，但 MC 是被动协议）
    socket.once("connect", () => {
      // 连接建立后再打点：从此刻起算纯 RTT
      start = Date.now();
      try {
        const handshakePayload = Buffer.concat([
          writeVarInt(PROTOCOL_VERSION),
          writeString(handshakeHost),
          writeUShort(resolved.port),
          writeVarInt(1), // next_state = 1 (status)
        ]);
        socket.write(framePacket(writePacket(0x00, handshakePayload)));
        socket.write(framePacket(writePacket(0x00, Buffer.alloc(0))));
      } catch (e) {
        finish({
          online: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });

    socket.connect(resolved.port, resolved.host);
  });
}

/* -------------------- MOTD 提取 -------------------- */

/**
 * MC 1.20+ 的 description 可能是 string / {text, color, ...} / {extra: [...]}
 * 这里尽量还原成单行可读字符串，丢失颜色信息但保留文本。
 *
 * depth 参数是防御性的：某些服务端插件会构造超深的 chat component，
 * 递归遍历会爆栈。32 层对正常 MC 协议来说绰绰有余。
 */
export function extractMotd(description: unknown, depth = 0): string {
  if (description == null) return "";
  if (depth > 32) return "";
  if (typeof description === "string") return description;
  if (typeof description !== "object") return String(description);

  const node = description as {
    text?: string;
    extra?: unknown[];
    translate?: string;
    with?: unknown[];
  };

  const parts: string[] = [];
  if (typeof node.text === "string") parts.push(node.text);
  if (Array.isArray(node.extra)) {
    for (const child of node.extra) {
      const part = extractMotd(child, depth + 1);
      if (part) parts.push(part);
    }
  }
  if (typeof node.translate === "string") {
    parts.push(node.translate);
    if (Array.isArray(node.with)) {
      for (const w of node.with) parts.push(extractMotd(w, depth + 1));
    }
  }
  return parts.join("");
}
