// 下界 (nether) + 末地 (end) 地标样本数据
//
// 数据格式见 @/lib/map/landmarks 里的 NewLandmark / NewRegionLabel / NewBuildingLandmark / NewMachineLandmark
// 跟 ./overworld.ts + ./index.ts 合并后作为 LANDMARKS 暴露给 app/map/page.tsx
//
// 添加新地标时直接编辑本文件, 格式参考已有条目; id 必须全局唯一 (跨主世界/下界/末地)
import type { NewWorldId } from "@/lib/map/loader";

import type { NewLandmark } from "@/lib/map/landmarks";

export const NETHER_LANDMARKS: NewLandmark[] = [

    {
      id: "ender-pearl-cannon",
      name: "矢量珍珠炮",
      x: 8,
      z: 25,
      targetZoom: 800,
      kind: "region",
      fontSize: { min: 14, max: 18, maxZoom: 800 },
    }
    , {
      id: "piglin-farm",
      name: "猪人塔",
      x: 311,
      z: -98,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "ghast-farm",
      name: "恶魂农场",
      x: 390,
      z: 82,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "wither-skeleton-farm",
      name: "凋灵骷髅农场",
      x: 4040,
      z: -1060,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "piglin-trading-hall",
      name: "猪灵交易所",
      x: -628,
      z: -32,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "boat-mob-farm-collection",
      name: "船吸刷怪塔收集",
      x: -338,
      z: 96,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "magma-cube-farm",
      name: "岩浆怪农场",
      x: -105,
      z: 94,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 10, max: 14, minZoom: 150, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "froglight-farm",
      name: "蛙明灯农场",
      x: -171,
      z: 90,
      offsetY: 15,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 10, max: 14, minZoom: 150, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "blaze-farm",
      name: "烈焰人农场",
      x: -217,
      z: 75,
      offsetY: -5,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 10, max: 14, minZoom: 150, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "basalt-generator",
      name: "玄武岩机",
      x: -4,
      z: -22,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 10, max: 14, minZoom: 200, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "porkchop-farm",
      name: "猪肉塔",
      x: 67,
      z: 26,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 10, max: 14, minZoom: 375, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "guardian-farm-collection",
      name: "守卫者农场收集",
      x: -38,
      z: -40,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 10, max: 12, minZoom: 375, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "overworld-pseudo-peaceful-switch",
      name: "主世界伪和平开关",
      x: 91,
      z: 305,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 10, max: 14, mid: 12 , midZoom: 150, maxZoom: 800 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    },

    {
      id: "witch-farm-exit",
      name: "出口-女巫塔",
      x: -608,
      z: -55,
      offsetY: -6,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 8, max: 12, mid: 10, midZoom: 300, maxZoom: 800  },
      },
    },
    {
      id: "boat-mob-farm-exit",
      name: "出口-船吸",
      x: -326,
      z: 80,
      offsetY: -7,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 8, max: 12, mid: 10, midZoom: 300, maxZoom: 800  },
      },
    },
    {
      id: "trial-chamber-exit",
      name: "出口-试炼密室",
      x: -238,
      z: 286,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, minZoom: 150, maxZoom: 800  },
      withLandmarks: {
        fontSize: { min: 12, max: 14, minZoom: 150, maxZoom: 800  },
      },
    },
    {
      id: "raid-farm-exit",
      name: "出口-袭击塔",
      x: 5,
      z: 286,
      offsetY: -6,
      offsetX: 4,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 8, max: 12, mid: 10, midZoom: 300, maxZoom: 800  },
      },
    },
    {
      id: "end-portal-and-sand-duper-exit",
      name: "出口-末地门/刷沙机",
      x: -90,
      z: -191,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 10, max: 12, mid: 12, midZoom: 300, maxZoom: 800  },
      },
    },
    {
      id: "octagonal-pagoda-exit",
      name: "出口-八角塔",
      x: 47,
      z: -66,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 12, minZoom: 200, maxZoom: 800  },
      withLandmarks: {
        fontSize: { min: 10, max: 12, minZoom: 200, maxZoom: 800  },
      },
    },
    {
      id: "map-art-factory-exit",
      name: "出口-地图画工厂",
      x: 118,
      z: -134,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 12, minZoom: 200, maxZoom: 800  },
      withLandmarks: {
        fontSize: { min: 10, max: 12, minZoom: 200, maxZoom: 800  },
      },
    },
    {
      id: "villager-trading-hall-exit",
      name: "出口-村民交易所",
      x: 14,
      z: -18,
      offsetY: -3,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 12, minZoom: 300, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 12, max: 12, minZoom: 800, maxZoom: 800  },
        offsetX: 38,
      },
    },
    {
      id: "base-exit",
      name: "出口-基地",
      x: 8,
      z: -6,
      offsetY: 7,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 14, max: 18, mid: 16, midZoom: 300, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 12, max: 12, minZoom: 600, maxZoom: 800  },
      },
    },
    {
      id: "gdufs-logo-exit",
      name: "出口-广外校徽",
      x: 288,
      z: -300,
      offsetY: 7,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 14, mid: 12, midZoom: 300, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 8, max: 12, mid: 10, midZoom: 300, maxZoom: 800 },
      },
    },
    {
      id: "piglin-farm-collection-exit",
      name: "出口-猪人塔收集",
      x: 272,
      z: -9,
      offsetX: 8,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 10, max: 14, mid: 12, midZoom: 300, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 8, max: 12, mid: 10, midZoom: 300, maxZoom: 800 },
      },
    },
    {
      id: "ice-farm-exit",
      name: "出口-刷冰机",
      x: 710,
      z: 5,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 12, max: 14, maxZoom: 800 },
      },
    },
    {
      id: "map-art-exit",
      name: "出口-翁法罗斯英雄纪地图画",
      x: 1850,
      z: -524,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 12, max: 14, maxZoom: 800 },
      },
    },
    {
      id: "bee-farm-exit",
      name: "出口-蜜蜂农场",
      x: -18,
      z: -643,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 12, max: 14, maxZoom: 800 },
      },
    },
    {
      id: "wither-skeleton-farm-collection-exit",
      name: "出口-凋灵骷髅农场收集",
      x: 4020,
      z: -1065,
      offsetY: -10,
      kind: "region",
      targetZoom: 800,
      description: "末影珍珠传送点, 传送到主城 spawn 区域。",
      popup: true,
      visibleWhen: "transit",
      fontSize: { min: 12, max: 14, maxZoom: 800 },
      withLandmarks: {
        fontSize: { min: 8, max: 12, mid: 10, midZoom: 300, maxZoom: 800 },
      },
    },
]

export const END_LANDMARKS: NewLandmark[] = [
    {
      id: "orbital-dragon-slayer-cannon",
      name: "天基屠龙炮",
      x: 0,
      z: 0,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 14, max: 18, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "water-stream-all-items-sorter",
      name: "水流全物品",
      x: 346,
      z: 160,
      targetZoom: 800,
      kind: "machine",
      fontSize: { min: 14, max: 18, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "clay-industrial-park",
      name: "粘土工业园",
      x: 400,
      z: 268,
      targetZoom: 600,
      kind: "region",
      fontSize: { min: 12, max: 16, mid: 14, midZoom: 200, maxZoom: 500 },
    }
    , {
      id: "chorus-fruit-farm",
      name: "紫颂果农场",
      x: -320,
      z: 3,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "concrete-solidifier-and-sand-duper-collection",
      name: "固化机/刷沙机收集",
      x: 100,
      z: 1,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 14, minZoom: 320, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "enderman-farm",
      name: "小黑塔",
      x: 205,
      z: 0,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "b36-tnt-tree-farm",
      name: "B36炸树场",
      x: 104,
      z: 306,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "shulker-farm",
      name: "潜影贝农场",
      x: -542,
      z: -780,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 14, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "640-furnace-array",
      name: "640熔炉组",
      x: 440,
      z: 160,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 14,minZoom: 250 , maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "dirt-generator",
      name: "泥土机",
      x: 390,
      z: 253,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 12, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "mud-generator",
      name: "泥巴机",
      x: 390,
      z: 279,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 12, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "pointed-dripstone-farm",
      name: "滴水石锥农场",
      x: 405,
      z: 258,
      offsetY: 5,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 10, max: 10, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
    , {
      id: "clay-generator",
      name: "粘土机",
      x: 412,
      z: 282,
      offsetY: 3,
      targetZoom: 600,
      kind: "machine",
      fontSize: { min: 12, max: 12, minZoom: 501, maxZoom: 600 },
      images: [
        "/images/landmarks/sample/machine-hero.svg",
      ],
      inputs: [
        { label: "村民", icon: "/icons/landmarks/sample/villager.svg" },
        { label: "床", icon: "/icons/landmarks/sample/bed.svg" },
        { label: "僵尸 (威胁)", icon: "/icons/landmarks/sample/zombie.svg" },
      ],
      outputs: [
        { label: "铁锭", icon: "/icons/landmarks/sample/iron-ingot.svg" },
        { label: "虞美人", icon: "/icons/landmarks/sample/poppy.svg" },
      ],
    }
];
