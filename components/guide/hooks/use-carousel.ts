"use client";

/**
 * useCarousel — 跨 step 边界的 carousel 翻页 hook
 *
 * 行为:
 * - step 内翻页: prev/next 在 step 内部循环
 * - 跨 step 边界: 在 step 末尾点 next → 切下一步第 1 张; 在 step 开头点 prev → 切上一步最后 1 张
 * - 全局边界: 第 1 步第 1 张 prev disabled; 最后 1 步最后 1 张 next disabled
 *
 * 约束:
 * - 接受完整 Step[] (保留 title / desc / iconSrc / textContent 等), 不只 images
 * - 显式 hasContent 守门, 避免 contents.length===0 时 prev/next 越界
 */

import { useState } from "react";

/** hook 需要的最小 step 形状 (用泛型让 caller 决定完整 type) */
export interface CarouselStep<TContent> {
  images: TContent[];
}

export interface UseCarouselReturn<TContent, TStep extends CarouselStep<TContent>> {
  active: TStep;
  activeIdx: number;
  contentIdx: number;
  contents: TContent[];
  current: TContent | undefined;
  hasContent: boolean;
  goTo: (step: number) => void;
  prev: () => void;
  next: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
}

export function useCarousel<TContent, TStep extends CarouselStep<TContent>>(
  steps: TStep[],
): UseCarouselReturn<TContent, TStep> {
  const [activeIdx, setActiveIdx] = useState(0);
  const [contentIdx, setContentIdx] = useState(0);

  // activeIdx 由 goTo 严格 bound, 必合法; ! 让 noUncheckedIndexedAccess 通过
  const active = steps[activeIdx]!;
  const contents = active.images;
  const current = contents[contentIdx];
  const hasContent = contents.length > 0;

  const isFirstStep = activeIdx === 0;
  const isLastStep = activeIdx === steps.length - 1;
  const isFirstContent = contentIdx === 0;
  const isLastContent = contentIdx === contents.length - 1;
  const prevDisabled = isFirstStep && isFirstContent;
  const nextDisabled = isLastStep && isLastContent;

  const goTo = (step: number) => {
    if (step === activeIdx) return;
    if (step < 0 || step >= steps.length) return;
    setActiveIdx(step);
    setContentIdx(0);
  };

  const prev = () => {
    if (!hasContent || prevDisabled) return;
    if (isFirstContent) {
      const prevStepIdx = activeIdx - 1;
      // 跨步后退: prevStepIdx 在 (0, activeIdx) 区间, 必合法
      setActiveIdx(prevStepIdx);
      setContentIdx(steps[prevStepIdx]!.images.length - 1);
    } else {
      setContentIdx(contentIdx - 1);
    }
  };

  const next = () => {
    if (!hasContent || nextDisabled) return;
    if (isLastContent) {
      setActiveIdx(activeIdx + 1);
      setContentIdx(0);
    } else {
      setContentIdx(contentIdx + 1);
    }
  };

  return {
    active,
    activeIdx,
    contentIdx,
    contents,
    current,
    hasContent,
    goTo,
    prev,
    next,
    prevDisabled,
    nextDisabled,
  };
}
