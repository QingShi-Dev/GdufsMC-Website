// 合并 sample 地标数据
//
// 拆分到两个文件是为了避免单个文件太长:
//   - overworld.ts:  主世界地标 (主)
//   - other-dims.ts: 下界 + 末地 (暂时数据少)
// 想加新地标直接编辑对应文件, 然后 import 过来即可
import type { NewLandmarkGroups } from "../map/landmarks";
import { OVERWORLD_LANDMARKS } from "./overworld";
import { END_LANDMARKS, NETHER_LANDMARKS } from "./other-dims";

export const SAMPLE_LANDMARKS: NewLandmarkGroups = {
  overworld: OVERWORLD_LANDMARKS,
  nether: NETHER_LANDMARKS,
  end: END_LANDMARKS,
};
