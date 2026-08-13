/* ===== engine/02-numeric.js（game-core.js 行 288-308）===== */
  /* 卡池精简（评审 P0-5）：v121/v122 已并入 engine/01-data.js 的 VOTER_TEMPLATES */

  /* AI 人格（从美式法律/政治文化提取）：
   * aggression 0~1：进攻性（影响攻击事件偏好/出牌数量）
   * economy 0~1：经济牌偏好（影响购买/刷新决策）
   * bonus：人格被动加成（vote=审议+票 / money=每轮+⊙）——让 AI 更像"有性格的对手" */
  const AI_PERSONALITIES = [
    { id: 'libertarian',    name: '自由派律师',     aggression: 0.35, economy: 0.8, bonus: { money: 1 } },
    { id: 'teaParty',       name: '民粹律师',       aggression: 0.7,  economy: 0.45, bonus: { vote: 1 } },
    { id: 'demSoc',         name: '平权律师',       aggression: 0.55, economy: 0.6 },
    { id: 'maga',           name: '鹰派律师',       aggression: 0.9,  economy: 0.35, bonus: { vote: 1 } },
    { id: 'greenNewDeal',   name: '环保律师',       aggression: 0.6,  economy: 0.55, bonus: { money: 1 } },
    { id: 'establishment',  name: '建制派律师',     aggression: 0.5,  economy: 0.65, bonus: { money: 1 } },
    { id: 'nevertrump',     name: '温和保守律师',   aggression: 0.3,  economy: 0.6 },
    { id: 'hollywood',      name: '名人律师',       aggression: 0.65, economy: 0.5, bonus: { vote: 1 } },
    /* ============ 更多人格扩充包（+4） ============ */
    { id: 'populist',       name: '民粹大状',       aggression: 0.85, economy: 0.3,  bonus: { vote: 1 } },
    { id: 'silicon',        name: '硅谷律师',       aggression: 0.4,  economy: 0.75, bonus: { money: 1 } },
    { id: 'military',       name: '军法律师',       aggression: 0.9,  economy: 0.4,  bonus: { vote: 1 } },
    { id: 'moderate',       name: '中立律师',       aggression: 0.3,  economy: 0.6,  bonus: { money: 1 } }
  ];
