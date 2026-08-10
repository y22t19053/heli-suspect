/* ===== engine/99-tail.js（导出）===== */
  return {
    createGame, apply, aiAct, advance,
    needsAIAction, humanActing, phaseLabel, myClickable,
    PHASE_STEPS, PHASE_STEPS_VISIBLE,
    PHASES,   // 状态描述表（评审四：每个阶段自包含 label/needsInput/update）
    buyCostOf, refreshCostOf, eventLvMax, incomeOf, rewardOf, marketSize,
    data: { CHARACTERS, VOTER_TEMPLATES, EVENT_TEMPLATES, SKILLS, CAMPS, AI_PERSONALITIES },
    mulberry32,
    feature, setFeature, getFeatures,   // 功能开关（Feature Toggle）
    doCountContinue,   // 测试钩子：仅用于单元测试直调结算（不影响任何运行路径）
    checkBlackSwan, finishGame, beginIncome  // 测试钩子：黑天鹅行为触发 / 终局判定 / 收入发放（供单测直调）
  };
});
