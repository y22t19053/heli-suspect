/* ===== engine/02-numeric.js（game-core.js 行 341-363）===== */
    { id: 'silicon',        name: '硅谷律师',       aggression: 0.4,  economy: 0.75, bonus: { money: 1 } },
    { id: 'military',       name: '军法律师',       aggression: 0.9,  economy: 0.4,  bonus: { vote: 1 } },
    { id: 'moderate',       name: '中立律师',       aggression: 0.3,  economy: 0.6,  bonus: { money: 1 } }
  ];

  /* 事件牌模板（lv：① ② ③ 分级；target：self 自己 / enemy 需选对方 / auto 自动） */
  const EVENT_TEMPLATES = [
    { id: 'e01', name: '当庭陈词',   lv: 1, timing: 'pre',  target: 'self',  eff: { type: 'vote', val: 1 },     desc: '庭审前：本方 +1 票' },
    { id: 'e02', name: '质疑证词',   lv: 1, timing: 'pre',  target: 'enemy', eff: { type: 'vote', val: -1 },    desc: '庭审前：指定对方 -1 票' },
    { id: 'e03', name: '追加陈词',   lv: 2, timing: 'pre',  target: 'self',  eff: { type: 'vote', val: 1 },     desc: '庭审前：本方 +1 票' },
    { id: 'e04', name: '揭发前科',   lv: 2, timing: 'pre',  target: 'enemy', eff: { type: 'vote', val: -1 },    desc: '庭审前：指定对方 -1 票' },
    { id: 'e05', name: '关键陈词',   lv: 3, timing: 'pre',  target: 'self',  eff: { type: 'vote', val: 2 },     desc: '庭审前：本方 +2 票' },
    { id: 'e06', name: '致命污点',   lv: 3, timing: 'pre',  target: 'enemy', eff: { type: 'vote', val: -2 },    desc: '庭审前：指定对方 -2 票' },
    { id: 'e07', name: '胜诉酬金',   lv: 1, timing: 'post', target: 'self',  eff: { type: 'money', val: 1 },    desc: '庭审后：本方 +1⊙' },
    { id: 'e08', name: '冻结资产',   lv: 1, timing: 'post', target: 'enemy', eff: { type: 'money', val: -1 },   desc: '庭审后：指定对方 -1⊙' },
    { id: 'e09', name: '舆论施压',   lv: 2, timing: 'post', target: 'auto',  eff: { type: 'rewardBuff', val: 1 }, desc: '庭审后：若本方本轮第一，倾向奖励 +1' },
    { id: 'e10', name: '抹黑对手',   lv: 2, timing: 'post', target: 'enemy', eff: { type: 'support', val: -1 }, desc: '庭审后：指定对方倾向 -1' },
    { id: 'e11', name: '终局陈词',   lv: 3, timing: 'post', target: 'auto',  eff: { type: 'rewardBuff', val: 2 }, desc: '庭审后：若本方本轮第一，倾向奖励 +2' },
    { id: 'e12', name: '庭外交易',   lv: 3, timing: 'post', target: 'enemy', eff: { type: 'support', val: -2 }, desc: '庭审后：指定对方倾向 -2' },
    { id: 'e21', name: '环境污染案',    lv: 2, timing: 'pre',  target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审前：所有玩家丑闻值 +1' },
    { id: 'e34', name: '禁酒令案',      lv: 1, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e36', name: '反恐案',        lv: 2, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e37', name: '军售丑闻案',    lv: 2, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
