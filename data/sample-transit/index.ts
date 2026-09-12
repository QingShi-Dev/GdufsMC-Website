/**
 * 地铁示例数据 — 跟 landmarks 类似的 pattern
 *  - 父组件 app/map/page.tsx import SAMPLE_TRANSIT
 *  - 用户加真实数据时, 修改 overworld.ts / other-dims.ts 即可
 */
import overworld from "./overworld";
import { nether, end } from "./other-dims";
import type { NewTransitGroups } from "@/lib/map/transit";

export const SAMPLE_TRANSIT: NewTransitGroups = {
  overworld,
  nether,
  end,
};
