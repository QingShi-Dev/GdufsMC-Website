/**
 * 地铁示例数据 — 跟 landmarks 类似的 pattern
 *  - 父组件 app/map/page.tsx import SAMPLE_METRO
 *  - 用户加真实数据时, 修改 overworld.ts / other-dims.ts 即可
 */
import overworld from "./overworld";
import { nether, end } from "./other-dims";
import type { NewMetroGroups } from "../new-metro-types";

export const SAMPLE_METRO: NewMetroGroups = {
  overworld,
  nether,
  end,
};
