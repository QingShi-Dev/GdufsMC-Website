// 合并地图地标数据
//
// 拆分到两个文件是为了避免单个文件太长:
//   - overworld.ts:  主世界地标 (主)
//   - other-dims.ts: 下界 + 末地
// 想加新地标直接编辑对应文件, 然后 import 过来即可
import type { NewLabelGroups } from "@/lib/map/labels";
import { OVERWORLD_LABELS } from "./overworld";
import { END_LABELS, NETHER_LABELS } from "./other-dims";

export const LABELS: NewLabelGroups = {
  overworld: OVERWORLD_LABELS,
  nether: NETHER_LABELS,
  end: END_LABELS,
};
