import { GuideMap } from "@/components/map/guide-map";
import { MapTabs } from "@/components/map/map-tabs";
import { loadMapData } from "@/lib/map/loader";
import { SAMPLE_LANDMARKS } from "@/lib/sample-landmarks";
import { SAMPLE_TRANSIT } from "@/lib/sample-transit";

/**
 * new-guide-map 示例页
 * - server component: 读 public/images/maps/20260907/ 拼成 NewWorldMeta[]
 * - client component: <GuideMap worlds={...} /> 接管 zoom/pan/fullscreen
 * - 顶部 tabs 跟 /map 页共用 MapTabs, 群系地图 tab 标题右侧带短 URL
 * - landmarks 用 SAMPLE_LANDMARKS, transit 用 SAMPLE_TRANSIT, 后续用户按格式自填
 */
export default function NewGuideMapPage() {
  const worlds = loadMapData();

  return (
    <div className="pt-28 sm:pt-34 pb-12 sm:pb-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="mx-auto max-w-7xl">
        <MapTabs />
        <div className="sm:mt-12">
          <GuideMap
            worlds={worlds}
            landmarks={SAMPLE_LANDMARKS}
            transit={SAMPLE_TRANSIT}
          />
        </div>
      </div>
    </div>
  );
}
