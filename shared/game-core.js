/* ============================================================
 * 合理怀疑 · 共享游戏规则引擎（重构版）
 * 按 2026-08 新规则重写：⊙经济 → 暗置出牌 → 亮出 → ①②③技能计票
 * → 事件牌(①②③分级) → 排名 → 支持度 → 弃牌 → 发⊙
 * 纯函数 + JSON 可序列化 plain-object 状态机。
 * 供服务端（联机）与浏览器端（单机渲染）共同使用。
 * ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ElectionCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 工具 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  let uidSeq = 1000;
  const nextUid = () => 'c' + (uidSeq++);

  /* ---------------- 阵营与配色 ---------------- */
  /* MVP：每位玩家 = 一个独立阵营（角色牌决定），独立计票、独立排名。
   * 规则中的"本阵营/各阵营/阵营顺序"均按玩家维度实现。 */
  const CAMPS = [
    { id: 'red',   name: '红方律师团', color: '#D82E2F' },
    { id: 'blue',  name: '蓝方律师团', color: '#012696' },
    { id: 'green', name: '绿方律师团', color: '#01847F' },
    { id: 'gold',  name: '金方律师团', color: '#E8A418' }
  ];

  /* 6 位律师角色（被动技能，3 选 1，同时亮出；起始 ⊙ = 4）
   * 技能全部唯一：相同技能的角色已合并——原教会辩护人/科技风投与铁腕大状同为"传唤 ⊙ -1"，
   * 合并为一个基础款「平民律师」（id 沿用 iron 避免历史引用）；其余每人一个独有技能。
   * 删减：媒体顾问 / 小镇名律 / 军法顾问 / 调解律师 / 教会辩护人 / 科技风投 */
  const CHARACTERS = [
    { id: 'rookie',     name: '见习律师',   camp: 'red',   desc: '起始⊙ +2',          skill: { type: 'startMoney', v: 2 } },
    { id: 'iron',       name: '平民律师',   camp: 'blue',  desc: '传唤证人 ⊙ -1',      skill: { type: 'buyDiscount', v: 1 } },
    { id: 'tycoon',     name: '律所金主',   camp: 'gold',  desc: '换证成本 -1',        skill: { type: 'refreshDiscount', v: 1 } },
    { id: 'orator',     name: '金牌大状',   camp: 'red',   desc: '证物架多抽 1 张',    skill: { type: 'drawPlus', v: 1 } },
    { id: 'organizer',  name: '首席助理',   camp: 'green', desc: '审议时本方 +1 票',   skill: { type: 'votePlus', v: 1 } },
    { id: 'pragmatist', name: '务实派律师', camp: 'blue',  desc: '可保留 2 份证词',    skill: { type: 'lockPlus', v: 1 } }
  ];

  /* 证词技能词典（① ② ③ 分级；证据排除在亮出阶段发动）
   * 左右博弈核心：swap/shiftLeft/shiftRight 改变行内位置（环形桌，行首尾相邻）；
   * flank/rally/pivot/counsel/poach 按相邻关系增减票数——2 人局中你的牌左右都是敌方牌。
   * src：真实法律案例设计注解（叙事深度：每个技能都源自一段法庭史）。 */
  const SKILLS = {
    terrorist:   { name: '证据排除', lv: 1, when: 'reveal', desc: '亮出时：排除对方 1 份已亮出的证据（作废）', src: '米兰达诉亚利桑那州（1966）：违宪取得的证据不得采信，程序正义的基石' },
    fan:         { name: '铁杆粉丝', lv: 1, when: 'count',  desc: '审议时：本方 +1 票', src: '辛普森案旁听席的狂热分化：公众站队本身就是证据' },
    troll:       { name: '庭外抹黑', lv: 1, when: 'count',  desc: '审议时：票数最高的对方 -1 票', src: '麦卡锡听证会：先扣帽子再谈事实的舆论绞杀' },
    swap:        { name: '程序动议', lv: 1, when: 'count',  desc: '审议时：与场上任意一张其他牌互换位置', src: '辛普森案辩方的程序战：用动议拖延和重组证据呈现顺序' },
    shiftLeft:   { name: '左席联动', lv: 1, when: 'count',  desc: '审议时：与左边相邻的牌互换位置', src: '法庭座次博弈：证人席的位置决定陪审团视线' },
    shiftRight:  { name: '右席联动', lv: 1, when: 'count',  desc: '审议时：与右边相邻的牌互换位置', src: '法庭座次博弈：证人席的位置决定陪审团视线' },
    counsel:     { name: '攻守同盟', lv: 1, when: 'count',  desc: '审议时：左右都是本方牌本方 +2 票，否则相邻有本方牌本方 +1 票', src: '共同被告联合辩护：律师团互为犄角（如多被告毒品案）' },
    orator:      { name: '雄辩陈词', lv: 2, when: 'count',  desc: '审议时：本方 +1 票', src: '克拉伦斯·丹罗在猴子审判的结案陈词：演说改变陪审团心智' },
    scandal:     { name: '当庭揭短', lv: 2, when: 'count',  desc: '审议时：票数最高的对方 -1 票', src: '富尔曼警探种族录音曝光：一句脏话毁掉整个指控' },
    wave:        { name: '舆论证言', lv: 2, when: 'count',  desc: '审议时：本方 +1 票，票数最高的对方 -1 票', src: '审判与媒体的双螺旋：舆论法庭先行判决' },
    flank:       { name: '左右夹击', lv: 2, when: 'count',  desc: '审议时：相邻有本方牌则票数最高的对方 -1 票（抱团者易被夹击）', src: '双律师质证战术：正反夹击使证人自相矛盾' },
    poach:       { name: '当庭挖票', lv: 2, when: 'count',  desc: '审议时：相邻有本方牌则偷票数最高的对方 1 票（敌 -1、本方 +1）', src: '陪审团争夺战：庭外调查员的策反艺术' },
    rally:       { name: '旁听声援', lv: 2, when: 'count',  desc: '审议时：相邻有本方牌则本方 +1 票（连坐人气，分散则哑火）', src: '大审判旁听席的民意压力：观众席也是一种法庭力量' },
    idol:        { name: '明星证人', lv: 3, when: 'count',  desc: '审议时：本方 +2 票', src: '迈克尔·杰克逊案明星证人团：知名度本身就是杀伤力' },
    megaScandal: { name: '致命污点', lv: 3, when: 'count',  desc: '审议时：票数最高的对方 -2 票', src: '水门录音带：实锤证据一锤定音' },
    comeback:    { name: '绝地反击', lv: 3, when: 'count',  desc: '审议时：若本方落后，+1 票', src: '丹罗在斯科普斯案的绝地翻盘：败局中的烈士辩护' },
    pivot:       { name: '险中取胜', lv: 3, when: 'count',  desc: '审议时：若左右都是敌方牌，本方 +2 票（换位可破）', src: '四面楚歌时的孤注一掷：重罪法庭的最后一搏' },
    donor:       { name: '胜诉酬金', lv: 0, when: 'post',   desc: '结算后：本方 +1⊙', src: '风险代理（Contingency Fee）：不赢不收费的诉讼融资' },
    buyback:     { name: '收买证词', lv: 0, when: 'post',   desc: '结算后：票数最高的对方 -1⊙', src: '证人收买丑闻：历史上反复出现的伪证交易' },
    /* —— 议题/站位系（条件发动，全部卡牌特有，参数在牌面上） —— */
    tagBoost:    { name: '议题共鸣', lv: 1, when: 'count',  desc: '审议时：本方 +1 票', src: '罗伊诉韦德案式议题动员：社会议题把法庭变成战场' },
    tagHate:     { name: '舆论压制', lv: 1, when: 'count',  desc: '审议时：票数最高的对方 -1 票', src: '麦卡锡式贴标签：先定义敌人再消灭敌人' },
    edge:        { name: '端点曝光', lv: 1, when: 'count',  desc: '审议时：若本牌位于行首或行尾（辩论端点），本方 +1 票', src: '证人席首尾效应：陪审团记住第一个和最后一个证人' },
    rowL:        { name: '左席取证', lv: 1, when: 'count',  desc: '审议时：若本牌位于亮出行的左半区，本方 +1 票', src: '法庭左席心理：物理位置塑造陪审团注意力' },
    rowR:        { name: '右席取证', lv: 1, when: 'count',  desc: '审议时：若本牌位于亮出行的右半区，本方 +1 票', src: '法庭右席心理：物理位置塑造陪审团注意力' },
    leftFoe:     { name: '压制左邻', lv: 1, when: 'count',  desc: '审议时：若左邻为对方牌，该牌 -1 票', src: '质证瞄准术：只打离你最近的敌人' },
    rightFoe:    { name: '压制右邻', lv: 1, when: 'count',  desc: '审议时：若右邻为对方牌，该牌 -1 票', src: '质证瞄准术：只打离你最近的敌人' },
    majority:    { name: '人多势众', lv: 1, when: 'count',  desc: '审议时：若本方当前票数领先（含并列），本方 +1 票', src: '从众陪审心理：多数派立场自我强化' },
    minority:    { name: '逆境反扑', lv: 1, when: 'count',  desc: '审议时：若本方当前票数落后，本方 +1 票', src: '孤证翻盘史：单个勇敢的持异议陪审员改变判决' },
    shame:       { name: '借题发挥', lv: 2, when: 'count',  desc: '审议时：若场上有丑闻牌，本方 +1 票', src: '丑闻放大效应：一旦有污点，舆论自动扩散' },
    threat:      { name: '王牌对垒', lv: 2, when: 'count',  desc: '审议时：若对方有 ③ 级技能牌，票数最高的对方 -1 票', src: '王牌证人对王牌证人：世纪审判的宿命对决' },
    /* —— 封神技（真实传奇律师招牌战术，全部卡牌特有） —— */
    crossExam:     { name: '交叉询问', lv: 2, when: 'count', desc: '审议时：相邻敌方证人 -1 票；若其带丑闻，额外 -1 票', src: '佩里·梅森式质证：问题早已知道答案，只等证人自投罗网' },
    objection:     { name: '反对!', lv: 1, when: 'count', desc: '审议时：若对方本场亮出 ②/③ 级技能牌，票数最高的对方 -1 票', src: '法庭反对程序：程序正义的日常武器' },
    reasonableDoubt: { name: '合理怀疑', lv: 3, when: 'count', desc: '审议时：若对方场上证据 ≥3 份，票数最高的对方 -2 票', src: '约翰尼·科克伦的"手套论"（辛普森案）："戴不上，就无罪"' },
    timelineSnipe: { name: '时间线狙击', lv: 3, when: 'count', desc: '审议时：若对方场上带技能的证据 ≥2 份，票数最高的对方 -1 票', src: '库鲁亚马（梅南德斯案）：用商店收据时间戳击穿不在场证明' },
    flipNarrative: { name: '翻转叙事', lv: 3, when: 'count', desc: '审议时：若本方落后 ≥2 票，本方 +2 票', src: '格里·斯宾塞（红宝石山脊）：把案件从"事实之争"翻转成"原则之争"' },
    careerGamble:  { name: '职业生涯赌局', lv: 3, when: 'count', desc: '审议时：本方 +2 票；若本方未领先，则本方丑闻 +1', src: '达登的"手套试验"豪赌：赌上职业生涯的最后一击' },
    credCollapse:  { name: '证人信誉崩塌', lv: 2, when: 'count', desc: '审议时：若对方有丑闻牌，票数最高的对方 -1 票', src: '富尔曼信誉崩塌：伪证史让整条证据链作废' },
    whistleblower: { name: '内部吹哨人', lv: 0, when: 'post', desc: '结算后：丑闻最高的对方 -1⊙ 且丑闻 +1', src: '弗兰克·瑟皮科：体制内吹哨人扳倒整个系统' },
    precedent:     { name: '确立先例', lv: 3, when: 'count', desc: '审议时：本方 +1 票，并记录本方"先例"标记（终局先例胜利）', src: '曼斯菲尔德勋爵（萨默塞特案）：一次判决改变一个时代的法律' },
    juryNull:      { name: '陪审团否决', lv: 3, when: 'count', desc: '审议时：本方 +1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）', src: '威廉·佩恩与曾格案：陪审团拒绝适用恶法，人民之诉' },
    /* —— 位置博弈系（做题！看清行首/行尾/半区再下注） —— */
    firstSeat:   { name: '首座质证', lv: 2, when: 'count', desc: '审议时：若行首（最左一张）是对方牌，该牌 -1 票', src: '证人席首位效应：谁坐在第一个位置，谁先被盘问' },
    lastSeat:    { name: '末席质证', lv: 2, when: 'count', desc: '审议时：若行尾（最右一张）是对方牌，该牌 -1 票', src: '末位记忆效应：陪审团对最后一个证人的印象最深' },
    leftWall:    { name: '左翼壁垒', lv: 3, when: 'count', desc: '审议时：本方所有位于行左半区的牌各 +1 票', src: '阵地战术：把整条证据链铺在陪审团视线左侧形成压迫' },
    randomHit:   { name: '抽签质证', lv: 2, when: 'count', desc: '审议时：随机 1 张对方牌 -1 票（赌运气）', src: '庭上掷骰：没有明确目标时，抽中谁算谁' }
  };
  /* 技能价值表（AI 选牌/买卖用；非列表内技能回退 2）—— 数值已按 ±1 化微调 */
  const SK_VAL = {
    fan: 2, troll: 2.2, terrorist: 2, swap: 1.6, shiftLeft: 1.4, shiftRight: 1.4, counsel: 2.6,
    orator: 2.6, scandal: 2.6, wave: 2.8, flank: 2.4, poach: 2.4, rally: 2.4, idol: 3.4, megaScandal: 3.4,
    comeback: 2.2, pivot: 3.0, donor: 2, buyback: 2.2, tagBoost: 2, tagHate: 2.2, edge: 2,
    rowL: 1.6, rowR: 1.6, leftFoe: 1.6, rightFoe: 1.6, majority: 1.6, minority: 1.6,
    shame: 2.2, threat: 2.4,
    crossExam: 3, objection: 2, reasonableDoubt: 3.8, timelineSnipe: 3.4, flipNarrative: 3.2,
    careerGamble: 3.2, credCollapse: 2.8, whistleblower: 2.4, precedent: 3.8, juryNull: 3.6,
    firstSeat: 2.2, lastSeat: 2.2, leftWall: 3.0, randomHit: 2.4
  };
  function skillVal(s) { return SK_VAL[s] !== undefined ? SK_VAL[s] : (s ? 2 : 0); }

  /* 90 张证人/证据牌模板（⊙ = 调查成本；votes = 基础采信票，默认 1；scandal = 单卡丑闻值）
   * 每张牌都有独立技能（无换名卡）：数值系（tagBoost 议题共鸣 / tagHate 舆论压制）、
   * 站位系（edge 端点 / rowL / rowR / leftFoe / rightFoe / majority / minority）、
   * 经典系（fan / troll / orator / scandal / wave / idol / megaScandal / comeback / pivot …）。 */
  const VOTER_TEMPLATES = [
    /* 基础牌（① 级数值/站位技能） */
    { id: 'v01', name: '学生证言',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v02', name: '老兵证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v03', name: '骑手证言',       cost: 1, votes: 1, skill: 'leftFoe', v: 1, desc: '若左邻为对方牌，该牌 -1 票' },
    { id: 'v04', name: '主妇证词',       cost: 2, votes: 1, skill: 'rowR', v: 1, desc: '若本牌位于亮出行右半区，本方 +1 票' },
    { id: 'v05', name: '教友证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v06', name: '失业工人证词',   cost: 2, votes: 1, skill: 'minority', v: 1, desc: '若本方当前票数落后对方，本方 +1 票' },
    { id: 'v07', name: '码农证言',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v08', name: '教授证词',       cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v09', name: '创投人证言',     cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v10', name: '维权者证词',     cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    /* 多票基础（少数高票牌，附条件技能） */
    { id: 'v11', name: '沉默旁证',       cost: 3, votes: 2, skill: 'edge', v: 1, desc: '若本牌位于行首或行尾，本方 +1 票' },
    { id: 'v12', name: '忠诚证人',       cost: 4, votes: 2, skill: 'shame', v: 2, desc: '若场上有丑闻牌，本方 +1 票' },
    { id: 'v13', name: '王牌证人',       cost: 4, votes: 2, skill: 'threat', v: 2, desc: '若对方有 ③ 级技能牌，票数最高的对方 -1 票' },
    /* ① 级技能（亮出阶段：证据排除） */
    { id: 'v14', name: '关键反证',       cost: 3, votes: 1, skill: 'terrorist' },
    /* ① 级技能（审议时） */
    { id: 'v15', name: '狂热支持者',     cost: 2, votes: 1, skill: 'fan' },
    { id: 'v16', name: '匿名抹黑者',     cost: 2, votes: 1, skill: 'troll' },
    /* ② 级技能（审议时） */
    { id: 'v17', name: '雄辩家',         cost: 3, votes: 1, skill: 'orator' },
    { id: 'v18', name: '揭短材料',       cost: 3, votes: 1, skill: 'scandal', scandal: 1 },
    { id: 'v19', name: '舆情报告',       cost: 4, votes: 1, skill: 'wave' },
    /* ③ 级技能（审议时） */
    { id: 'v20', name: '明星证人',       cost: 4, votes: 1, skill: 'idol' },
    { id: 'v21', name: '重磅黑料',       cost: 4, votes: 1, skill: 'megaScandal', scandal: 1 },
    { id: 'v22', name: '翻盘证词',       cost: 4, votes: 1, skill: 'comeback' },
    /* 结算后技能 */
    { id: 'v23', name: '献金记录',       cost: 3, votes: 1, skill: 'donor' },
    { id: 'v24', name: '买票记录',       cost: 4, votes: 1, skill: 'buyback', scandal: 1 },
    /* ============ 数据驱动扩充包（v25+，从美式社会人群/职业列表提取） ============ */
    { id: 'v25', name: '乡村证人',       cost: 1, votes: 1, skill: 'rightFoe', v: 1, desc: '若右邻为对方牌，该牌 -1 票' },
    { id: 'v26', name: '牧师证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v27', name: '工会领袖证词',   cost: 2, votes: 1, skill: 'rowL', v: 1, desc: '若本牌位于亮出行左半区，本方 +1 票' },
    { id: 'v28', name: '地产大亨供词',   cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v29', name: '主妇旁证',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v30', name: '移民证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v31', name: '执事证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v32', name: '学贷证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v33', name: '伤残军人证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v34', name: '店主证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v35', name: '枪协会员证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v36', name: '幕后金主供词',   cost: 4, votes: 2, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v37', name: '教师代表证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v38', name: '石油寡头供词',   cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v39', name: '游说者供词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票', scandal: 1 },
    { id: 'v40', name: '管道工证词',     cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v41', name: '街头活动家证词', cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v42', name: '租户证词',       cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v43', name: '农场主证词',     cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v44', name: '卡车司机证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v45', name: '巡边员证词',     cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v46', name: '诊所义工证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v47', name: '单亲妈妈证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v48', name: '电台主持证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v49', name: '阴谋论者证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v50', name: '电视布道家证词', cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v51', name: '教师证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v52', name: '家教家长证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v53', name: '反疫苗者证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v54', name: '跨性别者证词',   cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v55', name: '权益律师证词',   cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v56', name: '检察官证词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票', scandal: 1 },
    { id: 'v57', name: '强硬警长证词',   cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v58', name: '质疑证人',       cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v59', name: '民粹商家证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v60', name: '保守派证词',     cost: 2, votes: 1, skill: 'majority', v: 1, desc: '若本方当前票数领先（含并列），本方 +1 票' },
    { id: 'v61', name: '社运者证词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v62', name: '自由派证人',     cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v63', name: '民粹元老证词',   cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v64', name: '环保青年证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    /* ============ 左右博弈扩充包（v65+，换位/相邻技能） ============ */
    { id: 'v65', name: '掮客证词',       cost: 3, votes: 1, skill: 'swap' },
    { id: 'v66', name: '街头鼓动家证词', cost: 2, votes: 1, skill: 'shiftLeft' },
    { id: 'v67', name: '华尔街证人',     cost: 2, votes: 1, skill: 'shiftRight' },
    { id: 'v68', name: '社区证人',       cost: 3, votes: 1, skill: 'rally' },
    { id: 'v69', name: '顽固证人',       cost: 3, votes: 1, skill: 'flank' },
    { id: 'v70', name: '摇摆证人',       cost: 4, votes: 1, skill: 'pivot' },
    /* ============ 左右互动新技能（v89+：攻守同盟 / 当庭挖票） ============ */
    { id: 'v89', name: '并肩证人',       cost: 3, votes: 1, skill: 'counsel', desc: '左右都本方+2票；否则相邻本方+1票' },
    { id: 'v90', name: '反水线人',       cost: 3, votes: 1, skill: 'poach' },
    /* ============ 社会百态扩充包（v71+，更多美式人群/职业） ============ */
    { id: 'v71', name: '流浪者倡导证词', cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v72', name: '交易员证词',     cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v73', name: '医护证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v74', name: '主播证词',       cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v75', name: '书店老板证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v76', name: '咖啡店员证词',   cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v77', name: '房产经纪证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v78', name: '军商证词',       cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v79', name: '乡村歌手证词',   cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v80', name: '素食者证词',     cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v81', name: '健身教练证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v82', name: '数据科学家证词', cost: 3, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v83', name: '快递站长证词',   cost: 1, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v84', name: '橄榄球教练证词', cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v85', name: '币圈矿工证词',   cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票', scandal: 1 },
    { id: 'v86', name: '诊所护士证词',   cost: 2, votes: 1, skill: 'tagBoost', desc: '本方 +1 票' },
    { id: 'v87', name: '古董商证词',     cost: 2, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    { id: 'v88', name: '算法工程师证词', cost: 3, votes: 1, skill: 'tagHate', desc: '票数最高的对方 -1 票' },
    /* ============ 封神技扩充包（v91+，真实传奇律师招牌战术） ============ */
    { id: 'v91', name: '质证记录',       cost: 3, votes: 1, skill: 'crossExam', desc: '相邻敌方证人 -1 票；若其带丑闻，额外 -1 票' },
    { id: 'v92', name: '反对理由书',     cost: 2, votes: 1, skill: 'objection', desc: '对方亮出 ②/③ 级技能牌时，票数最高的对方 -1 票' },
    { id: 'v93', name: '手套证据',       cost: 4, votes: 1, skill: 'reasonableDoubt', desc: '对方场上证据 ≥3 份时，票数最高的对方 -2 票' },
    { id: 'v94', name: '收据时间戳',     cost: 4, votes: 1, skill: 'timelineSnipe', desc: '对方场上带技能的证据 ≥2 份时，票数最高的对方 -1 票' },
    { id: 'v95', name: '原则陈词',       cost: 4, votes: 1, skill: 'flipNarrative', desc: '本方落后 ≥2 票时，本方 +2 票' },
    { id: 'v96', name: '世纪豪赌',       cost: 4, votes: 1, skill: 'careerGamble', desc: '本方 +2 票；若本方未领先，则本方丑闻 +1' },
    { id: 'v97', name: '伪证前科档案',   cost: 4, votes: 1, skill: 'credCollapse', desc: '对方有丑闻牌时，票数最高的对方 -1 票' },
    { id: 'v98', name: '吹哨人档案',     cost: 3, votes: 1, skill: 'whistleblower', desc: '结算后：丑闻最高的对方 -1⊙ 且丑闻 +1' },
    { id: 'v99', name: '先例判词',       cost: 4, votes: 1, skill: 'precedent', desc: '本方 +1 票，并记录"先例"标记（终局先例胜利）' },
    { id: 'v100', name: '人民之诉',      cost: 4, votes: 1, skill: 'juryNull', desc: '本方 +1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）' },
    /* 位置博弈系（v101+）：首座/末席/左翼壁垒/抽签质证 */
    { id: 'v101', name: '首座证言',      cost: 2, votes: 1, skill: 'firstSeat', v: 1, desc: '若行首（最左）是对方牌，该牌 -1 票' },
    { id: 'v102', name: '末席证词',      cost: 2, votes: 1, skill: 'lastSeat', v: 1, desc: '若行尾（最右）是对方牌，该牌 -1 票' },
    { id: 'v103', name: '左翼方阵',      cost: 3, votes: 1, skill: 'leftWall', v: 1, desc: '本方所有位于行左半区的牌各 +1 票' },
    { id: 'v104', name: '抽签质证',      cost: 2, votes: 1, skill: 'randomHit', v: 1, desc: '随机 1 张对方牌 -1 票' }
  ];

  /* AI 人格（从美式法律/政治文化提取）：
   * aggression 0~1：进攻性（影响攻击事件偏好/出牌数量）
   * economy 0~1：经济牌偏好（影响购买/刷新决策）
   * bonus：人格被动加成（vote=审议+票 / money=每轮+⊙）——让 AI 更像"有性格的对手" */
  const AI_PERSONALITIES = [
    { id: 'libertarian',    name: '自由派律师',     icon: '🗽', aggression: 0.35, economy: 0.8, bonus: { money: 1 } },
    { id: 'teaParty',       name: '民粹律师',       icon: '🍵', aggression: 0.7,  economy: 0.45, bonus: { vote: 1 } },
    { id: 'demSoc',         name: '平权律师',       icon: '✊', aggression: 0.55, economy: 0.6 },
    { id: 'maga',           name: '鹰派律师',       icon: '🦅', aggression: 0.9,  economy: 0.35, bonus: { vote: 1 } },
    { id: 'greenNewDeal',   name: '环保律师',       icon: '🌱', aggression: 0.6,  economy: 0.55, bonus: { money: 1 } },
    { id: 'establishment',  name: '建制派律师',     icon: '🏛️', aggression: 0.5,  economy: 0.65, bonus: { money: 1 } },
    { id: 'nevertrump',     name: '温和保守律师',   icon: '🕊️', aggression: 0.3,  economy: 0.6 },
    { id: 'hollywood',      name: '名人律师',       icon: '🎬', aggression: 0.65, economy: 0.5, bonus: { vote: 1 } },
    /* ============ 更多人格扩充包（+4） ============ */
    { id: 'populist',       name: '民粹大状',       icon: '📣', aggression: 0.85, economy: 0.3,  bonus: { vote: 1 } },
    { id: 'silicon',        name: '硅谷律师',       icon: '💻', aggression: 0.4,  economy: 0.75, bonus: { money: 1 } },
    { id: 'military',       name: '军法律师',       icon: '🎖️', aggression: 0.9,  economy: 0.4,  bonus: { vote: 1 } },
    { id: 'moderate',       name: '中立律师',       icon: '⚖️', aggression: 0.3,  economy: 0.6,  bonus: { money: 1 } }
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
    { id: 'e38', name: '桃色丑闻案',    lv: 3, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },               desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e40', name: '计票争议案',    lv: 1, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },              desc: '庭审后：所有玩家丑闻值 +1' },
    { id: 'e41', name: '水门案',        lv: 3, timing: 'post', target: 'auto', eff: { type: 'scandalAll', val: 1 },              desc: '庭审后：所有玩家丑闻值 +1' }
  ];

  /* 事件牌按轮次解锁：轮1→①；轮2~3→①②；轮4+→①②③ */
  function eventLvMax(round) { return round <= 1 ? 1 : (round <= 3 ? 2 : 3); }
  /* 每轮结束发放的 ⊙（卡牌降价后同步加钱，保证买得起更多牌） */
  function incomeOf(round) { return 2; }   // 固定基础收入（卡价压缩后 2⊙ 即可循环买牌；末位+1/榜首-1 动态调整见 beginIncome）
  /* 支持度奖励 */
  function rewardOf(round) { return round <= 3 ? 2 : (round === 4 ? 3 : 4); }
  /* 市场槽位数（初始 4，组织能手 +1） */
  function marketSize(s) { return 4 + ((s.char && s.char.skill.type === 'drawPlus') ? s.char.skill.v : 0); }
  /* 购买价（全局 -1 降价；铁腕大状再 -1） */
  function buyCostOf(s, card) {
    let cost = Math.max(1, card.cost - 1 - ((s.char && s.char.skill.type === 'buyDiscount') ? s.char.skill.v : 0));
    return cost;
  }
  /* 刷新成本（幕后金主 -1；外交官每轮首次免费） */
  function refreshCostOf(s) {
    let c = s.refreshCost;
    if (s.char && s.char.skill.type === 'refreshDiscount') c = Math.max(0, c - s.char.skill.v);
    if (s.char && s.char.skill.type === 'firstRefreshFree' && !s.refreshUsed && !s.buyUsed) c = 0;
    return c;
  }
  /* 锁定上限（务实派 2 张） */
  function lockMax(s) { return 1 + ((s.char && s.char.skill.type === 'lockPlus') ? s.char.skill.v : 0); }

  /* ---------------- 状态构建 ---------------- */
  function makeSeat(i, name, isAI, rng) {
    return {
      seat: i, name, isAI, connected: !isAI,
      char: null, camp: null,
      side: null,              // 庭审角色：'prosecutor' 检方 / 'defense' 辩护方（开局分配）
      personality: null,       // AI 人格（人类为 null；AI 从 AI_PERSONALITIES 分配）
      money: 4, support: 0,          // 起始 ⊙ = 4（卡价压缩后 4⊙ 起步；倾向累计）
      scandal: 0,                    // 丑闻指数（声誉腐蚀，0~5）
      hand: [], market: [], events: [], played: [],   // 手牌 / 市场 / 事件手牌 / 本轮已亮出牌
      lockedUids: [], lastLockedUids: [],             // 本轮锁定（下轮保留）/ 上轮锁定
      refreshCost: 1, refreshUsed: false, buyUsed: false,
      buyDone: false, playDone: false, keepDone: false,
      eventCount: 0, eventPassed: false,
      stats: {
        playedCards: 0, eventsPlayed: 0, roundsWon: 0  // 历史累计
      }
    };
  }
  function makeVoter(tpl) { return Object.assign({}, tpl, { uid: nextUid(), scandal: tpl.scandal || 0 }); }
  function makeEvent(tpl) { return Object.assign({}, tpl, { uid: nextUid(), used: false }); }

  /* 初始牌堆：24 种 × 2 份 = 48 张 */
  function buildDeck(rng) {
    const list = [];
    VOTER_TEMPLATES.forEach(t => { list.push(makeVoter(t)); list.push(makeVoter(t)); });
    return shuffle(list, rng);
  }
  function buildEventDeck(rng) {
    const list = [];
    EVENT_TEMPLATES.forEach(t => { list.push(makeEvent(t)); list.push(makeEvent(t)); });
    return shuffle(list, rng);
  }

  function createGame(opts) {
    opts = opts || {};
    uidSeq = 1000;                    // 每局重置 uid（同种子完全可复现，超级更新#14）
    // —— 字段校验（超级更新#13）：seatCount / names / aiMask / seed 容错收敛 ——
    const rawCount = opts.seatCount;
    const seatCount = (typeof rawCount === 'number' && Number.isFinite(rawCount))
      ? clamp(Math.floor(rawCount), 2, 4)
      : (rawCount === undefined || rawCount === null ? 2 : clamp(Math.floor(Number(rawCount)) || 2, 2, 4));
    const rawSeed = opts.seed;
    const seed = (typeof rawSeed === 'number' && Number.isFinite(rawSeed))
      ? (rawSeed >>> 0)
      : (typeof rawSeed === 'string' && rawSeed.trim() !== '' ? hashStr(rawSeed) : (Date.now() % 2147483647));
    // #13 修复：保留用户输入的原始种子码字符串（无则 null），供结算屏/战报显示原串而非 hash 数字
    const seedRaw = (typeof rawSeed === 'string' && rawSeed.trim() !== '') ? rawSeed.trim() : null;
    const rng = mulberry32(seed);
    const names = Array.isArray(opts.names) ? opts.names : [];
    const aiMask = Array.isArray(opts.aiMask) ? opts.aiMask : [];
    const seats = [];
    for (let i = 0; i < seatCount; i++) {
      const isAI = !!aiMask[i];
      const rawName = names[i];
      const name = (typeof rawName === 'string' && rawName.trim())
        ? String(rawName).slice(0, 12)
        : ('玩家' + (i + 1));
      const seat = makeSeat(i, name, isAI, rng);
      if (isAI && AI_PERSONALITIES.length) {
        seat.personality = AI_PERSONALITIES[Math.floor(rng() * AI_PERSONALITIES.length)];
      }
      seats.push(seat);
    }
    // 庭审角色分配：检方 = ceil(n/2) 人（代表控方），其余为辩护方（代表被告律师）
    // 随机洗牌分配到座位——玩家每局可能扮演检方，也可能扮演辩护方
    {
      const nPros = Math.ceil(seatCount / 2);
      const sideList = [];
      for (let i = 0; i < seatCount; i++) sideList.push(i < nPros ? 'prosecutor' : 'defense');
      const shuffled = shuffle(sideList, rng);
      seats.forEach((s, i) => { s.side = shuffled[i]; });
    }
    const state = {
      version: 1, seatCount,
      seed,                             // 种子码（可复现；分享战绩用，超级更新#13）
      seedRaw,                          // 用户输入的原始种子码字符串（无则 null；显示/分享用 #13 修复）
      rng,                              // 随机源（抽签质证等随机技能用；测试可注入种子）
      phase: 'pickChar',
      round: 0,                // 当前轮次（1 起）
      startingSeat: 0,         // 本轮起始角色
      turn: 0,                 // 当前行动座位
      seats,
      draftCandidates: [],     // 每人 3 张候选角色
      deck: buildDeck(rng),
      eventDeck: buildEventDeck(rng),
      used: [],                // 洗回池（行牌/整理/未买证物架牌）
      grave: [],               // 档案（【移除】的牌，不洗入牌堆）
      row: [],                 // 中央亮出行 [{seat, card, revealed}]
      votes: [],               // 本轮计票结果（含事件修正）
      voteMod: [],             // 计票前事件修正
      roundRank: [],           // 本轮排名（高→低）
      rankInfo: [],            // [{seat, votes, power}]
      supportReward: 0,
      supportBuff: [],         // 计票后事件：若第一额外奖励
      starterPicker: -1,       // 需要选择起始玩家的座位（-1 = 第 1 轮自动随机）
      starterChosen: false,    // 起始玩家是否已被选定（防止随机覆盖）
      leaderStreak: 0,         // 连续排名第一的轮数（恐惧税用）
      prevFirst: -1,           // 上轮第一名座位（用于连任判断）
      revealIndex: 0,          // 逐张亮出进度（当前亮出到 row 第几张）
      revealPending: null,     // {seat, cardUid} 等待恐怖分子选目标
      swapPending: null,       // {owner, cardUid, candidates} 等待选换位目标（政治操盘）
      eventTurnSeat: -1,       // 事件阶段当前轮到
      eventTargetPending: null,// {seat, eventUid} 等待选事件目标
      discardSeat: -1,         // 整理阶段当前轮到
      precedentSeat: -1,       // 触发"确立先例"的座位（终局先例胜利判定）
      juryTokens: new Array(seatCount).fill(0),  // 各玩家陪审员支持（集满 3 立即胜诉）
      winType: 'support',      // 胜利类型：support / precedent / juryNull
      winner: null, gameOver: false,
      logs: []
    };
    // 每人 3 张候选角色（同时亮出）
    const pool = shuffle(CHARACTERS.slice(), rng);
    for (let i = 0; i < seatCount; i++) {
      const cand = shuffle(CHARACTERS.slice(), rng);
      state.draftCandidates.push(cand.slice(0, 3));
    }
    void pool;
    state.votes = new Array(seatCount).fill(0);
    state.voteMod = new Array(seatCount).fill(0);
    state.supportBuff = new Array(seatCount).fill(0);
    return state;
  }

  /* ---------------- 阶段推进 ---------------- */
  /* 状态描述表（顾问评审四）：每个阶段自包含
   *   label      —— 阶段标识
   *   needsInput —— (state, seat) 该座位当前是否需要玩家/AI 输入（驱动 needsAIAction/humanActing）
   *   update     —— 自动推进逻辑（调用 beginXxx 进入下一阶段；等待输入的阶段停在等待点）
   * advance(state) 查表驱动：签名与行为与旧巨型 switch 完全一致，
   * 服务端 pumpAutoAdvance / forceSkip / 全部单元测试直调不受影响。 */
  const PHASES = {
    pickChar: {
      label: 'pickChar',
      needsInput: (state, seat) => !state.seats[seat].char,
      update: (state) => {
        if (state.seats.every(s => s.char)) {
          const proN = state.seats.filter(s => s.side === 'prosecutor').map(s => s.name).join('、');
          const defN = state.seats.filter(s => s.side === 'defense').map(s => s.name).join('、');
          state.logs.push('⚖ 检方（控方）：' + proN + '  ｜  🛡 辩护方：' + defN);
          state.logs.push('律师揭晓：' + state.seats.map(s => s.name + '【' + s.char.name + '】').join('，'));
          beginStarter(state);
        }
      }
    },
    chooseStarter: {
      label: 'chooseStarter',
      needsInput: (state, seat) => state.starterPicker === seat,
      update: (state) => {
        // 第 1 轮：随机；后续：排名最低者选择
        if (state.starterPicker < 0) {
          state.startingSeat = Math.floor(state.rng() * state.seatCount);
          state.logs.push('第 ' + state.round + ' 轮由【' + state.seats[state.startingSeat].name + '】开始');
          beginRound(state);
        } else if (state.starterChosen) {
          // 已选定（人类 apply 或 AI 自行选择）
          state.logs.push('第 ' + state.round + ' 轮由【' + state.seats[state.startingSeat].name + '】开始');
          beginRound(state);
        } else if (!state.seats[state.starterPicker].isAI) {
          // 等待人类选择
        } else {
          // AI：选自己
          state.startingSeat = state.starterPicker;
          state.starterChosen = true;
          state.logs.push('排名最低的【' + state.seats[state.starterPicker].name + '】选择自己开始');
          beginRound(state);
        }
      }
    },
    drawEvent: { label: 'drawEvent', needsInput: () => false, update: (state) => beginVoter(state) },
    drawVoter: { label: 'drawVoter', needsInput: () => false, update: (state) => beginBuy(state) },
    buy: {
      label: 'buy',
      needsInput: (state, seat) => !state.seats[seat].buyDone,
      update: (state) => {
        if (state.seats.every(s => s.buyDone)) beginPlay(state);
      }
    },
    play: {
      label: 'play',
      needsInput: (state, seat) => state.turn === seat && !state.seats[seat].playDone,
      update: (state) => {
        // 轮流出牌：每回合只打 1 张，A→B→C→A→B→C 循环轮转，任何轮到的玩家都可放弃
        if (state.seats.every(s => s.playDone || s.hand.length === 0)) { beginReveal(state); return; }
        const cur = state.seats[state.turn];
        if (!cur || cur.playDone || cur.hand.length === 0) {
          if (cur && cur.hand.length === 0) cur.playDone = true;
          const next = nextPlaySeat(state);
          if (next < 0) { beginReveal(state); return; }
          state.playTurn = next; state.turn = next;
          state.logs.push(state.seats[next].name + ' 请暗置提交 1 份证据（或放弃）');
        }
      }
    },
    reveal: {
      label: 'reveal',
      needsInput: (state, seat) => !!(state.revealPending && state.revealPending.owner === seat),
      update: (state) => {
        // 逐张亮出：无待选目标时继续亮出下一张（恐怖分子按亮出顺序发动）
        if (!state.revealPending) revealNext(state);
      }
    },
    preEvent: {
      label: 'preEvent',
      needsInput: (state, seat) => state.eventTurnSeat === seat,
      update: (state) => {
        if (allEventsDone(state)) { doCount(state); }
      }
    },
    count: {
      label: 'count',
      needsInput: (state, seat) => !!(state.swapPending && state.swapPending.owner === seat),
      update: (state) => {
        // 政治操盘（换位）等待玩家选择目标则暂停；全部换位完成后继续计票
        if (state.swapPending) return;
        doCountContinue(state);
      }
    },
    postEvent: {
      label: 'postEvent',
      needsInput: (state, seat) => state.eventTurnSeat === seat,
      update: (state) => {
        if (allEventsDone(state)) doRank(state);
      }
    },
    rank: { label: 'rank', needsInput: () => false, update: (state) => doSettle(state) },
    settle: { label: 'settle', needsInput: () => false, update: (state) => beginDiscard(state) },
    discard: {
      label: 'discard',
      needsInput: (state, seat) => state.discardSeat === seat && !state.seats[seat].keepDone,
      update: (state) => {
        if (state.discardSeat < 0) { beginIncome(state); }
      }
    },
    income: {
      label: 'income',
      needsInput: () => false,
      update: (state) => {
        // 发 ⊙ 后进入下一轮或结束
        if (state.round >= 5) {
          state.phase = 'gameover';
          finishGame(state);
        } else {
          state.round++;
          beginStarter(state);
        }
      }
    }
  };

  /* 阶段推进：查表驱动。签名保持不变（服务端 pumpAutoAdvance/forceSkip 直调）。 */
  function advance(state) {
    if (state.gameOver) { state.version = (state.version || 0) + 1; return; }
    const def = PHASES[state.phase];
    if (def && def.update) def.update(state);
    state.version = (state.version || 0) + 1;
  }

  /* 起始玩家选择（第 1 轮随机，后续由上轮排名最低者选择） */
  function beginStarter(state) {
    if (state.round === 0) {
      state.round = 1;
      state.starterPicker = -1;            // 第 1 轮自动随机
      state.starterChosen = false;
    } else {
      const last = state.roundRank[state.roundRank.length - 1];
      state.starterPicker = (last === undefined) ? -1 : last;
      state.starterChosen = false;
      if (state.starterPicker >= 0) {
        state.logs.push('上轮排名最低的【' + state.seats[state.starterPicker].name + '】选择本轮起始玩家');
      }
    }
    state.phase = 'chooseStarter';
  }
  function beginRound(state) {
    state.phase = 'drawEvent';
    state.turn = state.startingSeat;
    state.voteMod = new Array(state.seatCount).fill(0);
    state.supportBuff = new Array(state.seatCount).fill(0);
    // 抽事件牌：从起始角色开始每人 1 张（状态机照常推进）
    for (let k = 0; k < state.seatCount; k++) {
      const s = state.seats[(state.startingSeat + k) % state.seatCount];
      if (!state.eventDeck.length) state.eventDeck = buildEventDeck(state.rng);
      s.events.push(state.eventDeck.pop());
    }
    state.logs.push('—— 第 ' + state.round + ' 轮 ——');
  }
  /* 抽证据（证物架）：保留上轮留证牌，补抽至证物架槽位 */
  function beginVoter(state) {
    state.phase = 'drawVoter';
    state.seats.forEach((s) => {
      // 上轮锁定的牌保留在市场
      const kept = s.market.filter(c => s.lastLockedUids.indexOf(c.uid) >= 0);
      const rest = s.market.filter(c => s.lastLockedUids.indexOf(c.uid) < 0);
      state.used.push(...rest);
      s.market = kept.slice();
      s.lockedUids = [];
      s.refreshCost = 1; s.refreshUsed = false; s.buyUsed = false;
      const need = marketSize(s) - s.market.length;
      for (let i = 0; i < need; i++) {
        if (!state.deck.length) reshuffle(state);
        if (!state.deck.length) break;
        s.market.push(state.deck.pop());
      }
    });
  }
  function beginBuy(state) {
    state.phase = 'buy';
    state.turn = state.startingSeat;
    state.seats.forEach(s => { s.buyDone = false; });
  }

  /* ---------------- 购买阶段 ---------------- */
  function buyCard(state, s, uid) {
    const card = s.market.find(c => c.uid === uid);
    if (!card) return { ok: false, msg: '该牌不在市场中' };
    const cost = buyCostOf(s, card);
    if (s.money < cost) return { ok: false, msg: '⊙ 不足' };
    if (s.buyDone) return { ok: false, msg: '已结束取证' };
    s.money -= cost; s.buyUsed = true;
    s.hand.push(card);
    s.market = s.market.filter(c => c !== card);
    if (state.deck.length) s.market.push(state.deck.pop());
    return { ok: true, msg: s.name + ' 传唤了【' + card.name + '】（-' + cost + '⊙）' };
  }
  function lockCard(state, s, uid) {
    const card = s.market.find(c => c.uid === uid);
    if (!card) return { ok: false, msg: '该牌不在市场中' };
    if (s.buyDone) return { ok: false, msg: '已结束取证' };
    const idx = s.lockedUids.indexOf(uid);
    if (idx >= 0) { s.lockedUids.splice(idx, 1); return { ok: true, msg: s.name + ' 取消了留证' }; }
    if (s.lockedUids.length >= lockMax(s)) return { ok: false, msg: '本轮最多留证 ' + lockMax(s) + ' 张' };
    if (s.lastLockedUids.indexOf(uid) >= 0) return { ok: false, msg: '不能连续两轮留证同一份证据' };
    s.lockedUids.push(uid);
    return { ok: true, msg: s.name + ' 留证了【' + card.name + '】（下轮保留）' };
  }
  function refreshMarket(state, s) {
    if (s.buyDone) return { ok: false, msg: '已结束取证' };
    const cost = refreshCostOf(s);
    if (s.money < cost) return { ok: false, msg: '⊙ 不足（换证需 ' + cost + '⊙）' };
    s.money -= cost; s.refreshUsed = true;
    s.refreshCost++;
    const kept = s.market.filter(c => s.lockedUids.indexOf(c.uid) >= 0);
    const rest = s.market.filter(c => s.lockedUids.indexOf(c.uid) < 0);
    state.used.push(...rest);
    s.market = kept.slice();
    while (s.market.length < marketSize(s)) {
      if (!state.deck.length) reshuffle(state);
      s.market.push(state.deck.pop());
    }
    return { ok: true, msg: s.name + ' 更换证物架（-' + cost + '⊙，下次 ' + s.refreshCost + '⊙）' };
  }
  function reshuffle(state) {
    if (state.used.length) { state.deck = shuffle(state.used, state.rng); state.used = []; }
  }

  /* ---------------- 出牌阶段（轮流 1 张：A→B→C→A→B→C 循环，行首尾相邻成环桌） ---------------- */
  function beginPlay(state) {
    state.phase = 'play';
    state.seats.forEach(s => { s.playDone = false; });
    state.playTurn = state.startingSeat;
    state.playLastSeat = -1;
    state.row = [];
    state.turn = state.playTurn;
    state.logs.push('举证阶段：' + state.seats[state.playTurn].name + ' 请暗置提交 1 份证据（或放弃）');
  }
  /* 下一个可行动座位（从当前座位之后按座位顺序循环，跳过已放弃/无牌者） */
  function nextPlaySeat(state) {
    const n = state.seatCount;
    for (let k = 1; k <= n; k++) {
      const seat = (state.playTurn + k) % n;
      const s = state.seats[seat];
      if (!s.playDone && s.hand.length > 0) return seat;
    }
    return -1;
  }
  /* 每回合只能暗置打出 1 张；打出后轮转到下一个可行动者（自己还有牌则下次轮到自己） */
  function playCards(state, s, uids) {
    if (state.phase !== 'play') return { ok: false, msg: '当前不是举证阶段' };
    if (state.turn !== s.seat) return { ok: false, msg: '还没轮到你' };
    if (s.playDone) return { ok: false, msg: '已放弃举证' };
    if (!uids || uids.length !== 1) return { ok: false, msg: '每回合只能暗置提交 1 份证据' };
    const card = s.hand.find(c => c.uid === uids[0]);
    if (!card) return { ok: false, msg: '手牌不存在' };
    s.hand = s.hand.filter(x => x !== card);
    state.row.push({ seat: s.seat, card: card, revealed: false });
    s.played.push(card);
    s.stats.playedCards++;
    state.logs.push(s.name + ' 暗置提交 1 份证据');
    // 轮转：还有手牌则轮到下一个可行动者（若只剩自己则继续轮到自己）
    if (s.hand.length > 0) {
      const next = nextPlaySeat(state);
      state.playTurn = next; state.turn = next;
      if (next === s.seat) state.logs.push('轮到 ' + s.name + ' 继续举证（或放弃）');
      else state.logs.push('轮到 ' + state.seats[next].name + ' 举证');
    }
    return { ok: true };
  }
  /* 任何轮到的玩家都可放弃出牌（不再要求"最后一名"） */
  function finishPlay(state, s) {
    if (state.phase !== 'play' || state.turn !== s.seat || s.playDone) return { ok: false, msg: '当前不能放弃举证' };
    s.playDone = true;
    state.logs.push(s.name + ' 放弃举证');
    return { ok: true };
  }

  /* ---------------- 亮出阶段（从左到右逐张亮出，恐怖分子按亮出顺序发动） ---------------- */
  function beginReveal(state) {
    state.phase = 'reveal';
    state.revealIndex = 0;
    state.revealPending = null;
    revealNext(state);
  }
  /* 亮出下一张（每次调用只亮一张，便于渲染逐张播放动画）；亮完则进入计票前事件阶段 */
  function revealNext(state) {
    // 跳过已被恐怖分子炸掉的牌
    while (state.revealIndex < state.row.length && state.row[state.revealIndex].removed) state.revealIndex++;
    if (state.revealIndex >= state.row.length) {
      if (!state.row.length) state.logs.push('无人举证，直接进入事件阶段');
      beginPreEvent(state);
      return;
    }
    const r = state.row[state.revealIndex];
    r.revealed = true;
    state.logs.push('🔎 亮出：' + state.seats[r.seat].name + ' 的【' + r.card.name + '】');
    // 恐怖分子：亮出时立即发动（只能炸已亮出的对方牌）
    if (r.card.skill === 'terrorist') {
      const targets = state.row.filter(x => x.revealed && x.seat !== r.seat && !x.removed);
      if (targets.length) {
        state.revealPending = { seat: r.seat, cardUid: r.card.uid, owner: r.seat };
        state.logs.push('💣 【' + state.seats[r.seat].name + '】的【证据排除】发动：请选择 1 份对方已亮出的证据');
        return; // 等待玩家选择目标
      }
      state.logs.push('💣 【' + state.seats[r.seat].name + '】的恐怖分子无目标可炸');
    }
    state.revealIndex++;
  }
  /* 证据排除选择目标（被移除的牌进档案，不洗入牌堆） */
  function resolveTerrorist(state, targetUid) {
    const p = state.revealPending;
    if (!p) return { ok: false, msg: '没有待发动的恐怖分子' };
    const target = state.row.find(r => r.card.uid === targetUid);
    if (!target || target.removed || !target.revealed) return { ok: false, msg: '目标不存在或未亮出' };
    if (target.seat === p.owner) return { ok: false, msg: '不能炸自己的牌' };
    target.removed = true;
    state.grave.push(target.card);
    state.logs.push('💣 【' + state.seats[p.owner].name + '】的证据排除作废了【' + state.seats[target.seat].name + '】的【' + target.card.name + '】（进档案）');
    state.revealPending = null;
    state.revealIndex++; // 跳过恐怖分子这张，由 advance('reveal') 继续亮下一张
    return { ok: true };
  }

  /* ---------------- 环形桌邻位（行首尾相邻：第 0 张的左边 = 最后一张） ---------------- */
  function rowNeighbor(state, idx, dir) {
    const n = state.row.length;
    if (n <= 1) return null;
    return state.row[(idx + dir + n) % n];
  }
  function swapRow(state, a, b) {
    const t = state.row[a];
    state.row[a] = state.row[b];
    state.row[b] = t;
  }
  /* 换位技能结算（计票前）：shift 自动换位（每张牌只换一次）；swap 需要玩家选择目标（swapPending） */
  function applyMoves(state) {
    // 1. 自动换位：合纵左移 / 连横右移（从左到右，与相邻牌互换；每张只执行一次防死循环）
    for (let i = 0; i < state.row.length; i++) {
      const r = state.row[i];
      if (r.removed || r._nullified || r._moved) continue;
      if (r.card.skill === 'shiftLeft' || r.card.skill === 'shiftRight') {
        const dir = r.card.skill === 'shiftLeft' ? -1 : 1;
        const nb = rowNeighbor(state, i, dir);
        if (nb && !nb.removed && nb.card.uid !== r.card.uid && !nb._moved) {
          const j = state.row.indexOf(nb);
          swapRow(state, i, j);
          r._moved = true;
          state.logs.push('↔️ 【' + state.seats[r.seat].name + '】的【' + r.card.name + '】与【' + nb.card.name + '】互换位置');
          i = -1; // 重扫（位置已变化）
        }
      }
    }
    // 2. 政治操盘：需玩家选择目标（每张只处理一次）
    for (let i = 0; i < state.row.length; i++) {
      const r = state.row[i];
      if (r.removed || r._nullified || r._moved || r.card.skill !== 'swap') continue;
      const candidates = state.row.filter(x => !x.removed && x.card.uid !== r.card.uid);
      if (!candidates.length) continue;
      state.swapPending = { owner: r.seat, cardUid: r.card.uid, candidates: candidates.map(x => x.card.uid) };
      state.logs.push('🤝 【' + state.seats[r.seat].name + '】的【程序动议】发动：请选择 1 张其他证据互换位置');
      return false; // 暂停计票，等待选择
    }
    return true;
  }
  function resolveSwap(state, targetUid) {
    const p = state.swapPending;
    if (!p) return { ok: false, msg: '没有待处理的换位' };
    const t = state.row.find(x => x.card.uid === targetUid);
    if (!t || t.removed) return { ok: false, msg: '目标不存在' };
    if (t.card.uid === p.cardUid) return { ok: false, msg: '不能和自己互换' };
    const a = state.row.findIndex(x => x.card.uid === p.cardUid);
    const b = state.row.indexOf(t);
    swapRow(state, a, b);
    state.row[b]._moved = true; // 这张政治操盘已发动，不再重复
    state.logs.push('🤝 【' + state.seats[p.owner].name + '】的【程序动议】将【' + state.row[b].card.name + '】与【' + t.card.name + '】互换位置');
    state.swapPending = null;
    // 若还有下一张政治操盘则继续等待，否则由 advance('count') 继续计票
    if (!applyMoves(state)) return { ok: true, msg: '继续选择下一个换位目标' };
    return { ok: true };
  }

  /* ---------------- 事件牌阶段（计票前 / 计票后） ---------------- */
  function beginPreEvent(state) {
    state.phase = 'preEvent';
    startEventPhase(state);
  }
  function beginPostEvent(state) {
    state.phase = 'postEvent';
    startEventPhase(state);
  }
  /* 由起始角色指定的角色开始（MVP：默认从起始角色开始） */
  function startEventPhase(state) {
    const n = state.seatCount;
    state.seats.forEach(s => { s.eventCount = 0; s.eventPassed = false; });
    state.eventStall = 0;
    state.eventTurnSeat = state.startingSeat;
    state.turn = state.eventTurnSeat;
    state.logs.push((state.phase === 'preEvent' ? '庭审前' : '庭审后') + '事件阶段开始：' + state.seats[state.eventTurnSeat].name + ' 是否打出事件牌？');
  }
  function eventLvOK(state, ev) { return ev.lv <= eventLvMax(state.round); }
  function usableEvents(state, s) {
    if (s.eventPassed || s.eventCount >= 2) return [];
    return s.events.filter(ev => !ev.used && ev.timing === (state.phase === 'preEvent' ? 'pre' : 'post') && eventLvOK(state, ev));
  }
  /* 事件阶段结束条件：所有人都选择不继续或打满 2 张 */
  function allEventsDone(state) {
    return state.seats.every(s => s.eventPassed || s.eventCount >= 2 || usableEvents(state, s).length === 0);
  }
  /* 轮到下一个可行动者（多轮循环，直至所有角色都选择不继续） */
  function nextEventSeat(state) {
    const n = state.seatCount;
    for (let k = 1; k <= n; k++) {
      const seat = (state.eventTurnSeat + k) % n;
      const s = state.seats[seat];
      if (!s.eventPassed && s.eventCount < 2 && usableEvents(state, s).length > 0) return seat;
    }
    return -1;
  }
  function playEvent(state, s, uid, targetSeat) {
    const ev = s.events.find(e => e.uid === uid);
    if (!ev || ev.used) return { ok: false, msg: '事件牌不存在或已使用' };
    if (!usableEvents(state, s).some(e => e.uid === uid)) return { ok: false, msg: '该事件牌当前不可用（分级/数量限制）' };
    if (ev.timing !== (state.phase === 'preEvent' ? 'pre' : 'post')) return { ok: false, msg: '时机不符' };
    // enemy 类需指定目标
    if (ev.target === 'enemy') {
      if (targetSeat === undefined || targetSeat === null || targetSeat === s.seat) return { ok: false, msg: '请选择事件目标' };
      if (targetSeat < 0 || targetSeat >= state.seatCount || targetSeat === s.seat) return { ok: false, msg: '非法目标' };
    }
    if (state.eventTargetPending) return { ok: false, msg: '请先处理待选目标' };
    if (state.eventTurnSeat !== s.seat) return { ok: false, msg: '还没轮到你' };
    // 硅谷地区：事件牌费用 ⊙2（文化地域印记）
    ev.used = true;
    s.events = s.events.filter(e => e !== ev);
    s.eventCount++;
    s.stats.eventsPlayed++;
    const tgt = ev.target === 'enemy' ? targetSeat : (ev.target === 'self' ? s.seat : -1);
    if (ev.target === 'enemy') {
      state.logs.push(s.name + ' 打出事件【' + ev.name + '】→ ' + state.seats[tgt].name);
    } else {
      state.logs.push(s.name + ' 打出事件【' + ev.name + '】');
    }
    applyEventEff(state, s, ev, tgt);
    // 推进到下一个可行动者（多轮循环，直至所有角色都选择不继续）
    const next = nextEventSeat(state);
    if (next >= 0) { state.eventTurnSeat = next; state.turn = next; state.logs.push('轮到 ' + state.seats[next].name + ' 选择是否打出事件牌'); }
    return { ok: true };
  }
  function applyEventEff(state, s, ev, tgt) {
    const e = ev.eff;
    const buff = (s.char && s.char.skill.type === 'eventBuff' && e.val > 0) ? s.char.skill.v : 0;
    if (state.phase === 'preEvent') {
      // 庭审前：修改票数修正 / 全局公共议题
      if (e.type === 'vote') {
        if (e.val > 0) state.voteMod[s.seat] += e.val + buff;
        else {
          state.voteMod[tgt] += e.val;
          // 丑闻类事件（舆论风波/惊天丑闻）直接腐蚀对手声誉
          if (ev.id === 'e04' || ev.id === 'e06') applyScandalEffects(state, tgt);
        }
      } else if (e.type === 'scandalAll') {
        // 全局丑闻：所有玩家丑闻值 +val
        for (let i = 0; i < state.seatCount; i++) applyScandalEffects(state, i);
        state.logs.push('😱 公共议题【' + ev.name + '】：所有玩家丑闻值 +' + (e.val || 1));
      }
    } else {
      // 计票后
      if (e.type === 'money') {
        if (e.val > 0) s.money += e.val + buff;
        else state.seats[tgt].money = Math.max(0, state.seats[tgt].money + e.val);
      } else if (e.type === 'rewardBuff') {
        state.supportBuff[s.seat] += e.val + buff;
      } else if (e.type === 'support') {
        state.seats[tgt].support = Math.max(0, state.seats[tgt].support + e.val);
      } else if (e.type === 'scandalAll') {
        for (let i = 0; i < state.seatCount; i++) applyScandalEffects(state, i);
        state.logs.push('😱 公共议题【' + ev.name + '】：所有玩家丑闻值 +' + (e.val || 1));
      }
    }
  }
  function passEvent(state, s) {
    s.eventPassed = true;
    state.logs.push(s.name + ' 选择不打出事件牌');
    const next = nextEventSeat(state);
    if (next >= 0) { state.eventTurnSeat = next; state.turn = next; state.logs.push('轮到 ' + state.seats[next].name + ' 选择是否打出事件牌'); }
    return { ok: true };
  }

  /* ---------------- 计票中（换位 → 丑闻惩罚 → 技能 ①→②→③） ---------------- */
  function doCount(state) {
    state.phase = 'count';
    // 先结算换位技能：shift 自动换位；政治操盘需玩家选目标（暂停等待）
    if (!applyMoves(state)) return;
    doCountContinue(state);
  }
  function doCountContinue(state) {
    const n = state.seatCount;
    // 1. 基础票：每张未移除的牌投其 votes 票（单卡自带丑闻按 scandal 扣票）
    const votes = new Array(n).fill(0);
    state.row.forEach(r => {
      if (r.removed || r._nullified) return;
      let base = (r.card.votes || 1) - (r.card.scandal || 0);
      votes[r.seat] += Math.max(0, base);
    });
    // 2. 计票前事件修正
    for (let i = 0; i < n; i++) votes[i] += state.voteMod[i];
    // 4. 角色被动：组织能手 +1 票；AI 人格被动：激进人格 +票
    state.seats.forEach((s, i) => {
      if (s.char && s.char.skill.type === 'votePlus') votes[i] += s.char.skill.v;
      if (s.personality && s.personality.bonus && s.personality.bonus.vote) votes[i] += s.personality.bonus.vote;
    });
    // 5. 玩家丑闻指数：声誉腐蚀，全部票数 - scandal
    state.seats.forEach((s, i) => {
      if (s.scandal) {
        votes[i] -= s.scandal;
        state.logs.push('😈 【' + s.name + '】丑闻缠身（' + s.scandal + '/5），票数 -' + s.scandal);
      }
    });
    // 7. 计票时技能：lv 1 → 2 → 3，行内从左到右（失效牌不发动）
    for (let lv = 1; lv <= 3; lv++) {
      state.row.forEach((r, idx) => {
        if (r.removed || r._nullified || !r.card.skill) return;
        const sk = SKILLS[r.card.skill];
        if (sk.when !== 'count' || sk.lv !== lv) return;
        const owner = r.seat;
        switch (r.card.skill) {
          case 'fan': votes[owner] += 1; break;
          case 'troll': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 1; break; }
          case 'swap': case 'shiftLeft': case 'shiftRight': break; // 换位已在计票前结算
          case 'counsel': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyL = nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner;
            const allyR = nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner;
            if (allyL && allyR) votes[owner] += 2;        // 左右夹逼：攻守同盟完全体 +2
            else if (allyL || allyR) votes[owner] += 1;   // 单侧联动 +1
            break;
          }
          case 'orator': votes[owner] += 1; break;
          case 'scandal': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 1; applyScandalEffects(state, t); break; }
          case 'wave': votes[owner] += 1; votes[highestEnemy(votes, owner, n, state.rng)] -= 1; break;
          // —— 左右博弈技能：相邻有本方牌才发动（想触发就得多牌连坐 / 用换位凑阵） ——
          case 'flank': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyNear = (nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner)
              || (nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner);
            if (allyNear) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'poach': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyNear = (nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner)
              || (nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner);
            if (allyNear) { votes[highestEnemy(votes, owner, n, state.rng)] -= 1; votes[owner] += 1; }
            break;
          }
          case 'rally': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            const allyNear = (nbL && !nbL.removed && !nbL._nullified && nbL.seat === owner)
              || (nbR && !nbR.removed && !nbR._nullified && nbR.seat === owner);
            if (allyNear) votes[owner] += 1;
            break;
          }
          case 'pivot': {
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            if (nbL && nbR && !nbL.removed && !nbR.removed && nbL.seat !== owner && nbR.seat !== owner) votes[owner] += 2;
            break;
          }
          case 'idol': votes[owner] += 2; break;
          case 'megaScandal': { const t = highestEnemy(votes, owner, n, state.rng); votes[t] -= 2; applyScandalEffects(state, t); break; }
          case 'comeback': {
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] < maxOther) votes[owner] += 1;
            break;
          }
          // —— 议题/站位系技能（无条件发动） ——
          case 'tagBoost': votes[owner] += 1; break;
          case 'tagHate': votes[highestEnemy(votes, owner, n, state.rng)] -= 1; break;
          case 'edge': {
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const pos = act.indexOf(r);
            if (pos === 0 || pos === act.length - 1) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'rowL': {
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const pos = act.indexOf(r);
            if (pos >= 0 && pos * 2 < act.length) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'rowR': {
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const pos = act.indexOf(r);
            if (pos >= 0 && pos * 2 >= act.length) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'leftFoe': {
            const nbL = rowNeighbor(state, idx, -1);
            if (nbL && !nbL.removed && !nbL._nullified && nbL.seat !== owner) votes[nbL.seat] -= (r.card.v || 1);
            break;
          }
          case 'rightFoe': {
            const nbR = rowNeighbor(state, idx, 1);
            if (nbR && !nbR.removed && !nbR._nullified && nbR.seat !== owner) votes[nbR.seat] -= (r.card.v || 1);
            break;
          }
          case 'majority': {
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] >= maxOther) votes[owner] += (r.card.v || 1);
            break;
          }
          case 'minority': {
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] < maxOther) votes[owner] += (r.card.v || 1);
            break;
          }
          /* —— 位置博弈系（做题：看谁占行首/行尾/左半区） —— */
          case 'firstSeat': {
            // 首座质证：行首（最左一张）是对方牌 → 该牌 -1
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const lead = act[0];
            if (lead && lead.seat !== owner) votes[lead.seat] -= (r.card.v || 1);
            break;
          }
          case 'lastSeat': {
            // 末席质证：行尾（最右一张）是对方牌 → 该牌 -1
            const act = state.row.filter(x => !x.removed && !x._nullified);
            const tail = act[act.length - 1];
            if (tail && tail.seat !== owner) votes[tail.seat] -= (r.card.v || 1);
            break;
          }
          case 'leftWall': {
            // 左翼壁垒：本方所有位于行左半区的牌各 +1（站位团）
            const act = state.row.filter(x => !x.removed && !x._nullified);
            act.forEach((x, i) => {
              if (x.seat === owner && i * 2 < act.length) votes[owner] += 1;
            });
            break;
          }
          case 'randomHit': {
            // 抽签质证：随机 1 张对方牌 -1（赌运气）
            const act = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner);
            if (act.length) {
              const rng = state.rng || Math.random;
              const hit = act[Math.floor(rng() * act.length)];
              votes[hit.seat] -= (r.card.v || 1);
            }
            break;
          }
          case 'shame': {
            if (state.row.some(x => !x.removed && !x._nullified && (x.card.scandal || 0) > 0)) votes[owner] += 1;
            break;
          }
          case 'threat': {
            const hasLv3 = state.row.some(x => !x.removed && !x._nullified && x.seat !== owner
              && x.card.skill && SKILLS[x.card.skill] && SKILLS[x.card.skill].lv >= 3);
            if (hasLv3) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          /* —— 封神技（真实传奇律师招牌战术） —— */
          case 'crossExam': {
            // 交叉询问：相邻敌方证人 -1；若该证人带丑闻，额外 -1
            const nbL = rowNeighbor(state, idx, -1);
            const nbR = rowNeighbor(state, idx, 1);
            [nbL, nbR].forEach(nb => {
              if (nb && !nb.removed && !nb._nullified && nb.seat !== owner) {
                let dmg = 1;
                if ((nb.card.scandal || 0) > 0) dmg += 1;
                votes[nb.seat] -= dmg;
              }
            });
            break;
          }
          case 'objection': {
            // 反对!：对方本场亮出 ②/③ 级技能牌 → 最高对方 -1
            const hasHigh = state.row.some(x => !x.removed && !x._nullified && x.seat !== owner
              && x.card.skill && SKILLS[x.card.skill] && SKILLS[x.card.skill].lv >= 2);
            if (hasHigh) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'reasonableDoubt': {
            // 合理怀疑：对方场上证据 ≥3 → 最高对方 -2（"戴不上，就无罪"）
            const enemyN = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner).length;
            if (enemyN >= 3) votes[highestEnemy(votes, owner, n, state.rng)] -= 2;
            break;
          }
          case 'timelineSnipe': {
            // 时间线狙击：对方带技能证据 ≥2 → 最高对方 -1（收据时间戳）
            const skN = state.row.filter(x => !x.removed && !x._nullified && x.seat !== owner
              && x.card.skill && SKILLS[x.card.skill]).length;
            if (skN >= 2) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'flipNarrative': {
            // 翻转叙事：本方落后 ≥2 → 本方 +2（把事实之争翻成原则之争）
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] <= maxOther - 2) votes[owner] += 2;
            break;
          }
          case 'careerGamble': {
            // 职业生涯赌局：+2 票；未领先则丑闻 +1（豪赌的代价）
            votes[owner] += 2;
            const maxOther = Math.max(...votes.filter((_, j) => j !== owner));
            if (votes[owner] < maxOther) applyScandalEffects(state, owner);
            break;
          }
          case 'credCollapse': {
            // 证人信誉崩塌：对方有丑闻牌 → 最高对方 -1
            const hasScandal = state.row.some(x => !x.removed && !x._nullified && x.seat !== owner
              && (x.card.scandal || 0) > 0);
            if (hasScandal) votes[highestEnemy(votes, owner, n, state.rng)] -= 1;
            break;
          }
          case 'precedent': {
            // 确立先例：+1 票并记录先例标记（终局先例胜利）
            votes[owner] += 1;
            if (state.precedentSeat === undefined || state.precedentSeat < 0) {
              state.precedentSeat = owner;
              state.logs.push('⚖️ 判例确立：【' + state.seats[owner].name + '】的辩护将成为后世先例');
            }
            break;
          }
          case 'juryNull': {
            // 陪审团否决：+1 票并获得 1 名陪审员支持（集满 3 名立即胜诉）
            votes[owner] += 1;
            state.juryTokens = state.juryTokens || new Array(state.seatCount).fill(0);
            state.juryTokens[owner] = (state.juryTokens[owner] || 0) + 1;
            state.logs.push('⚖️ 陪审员转向：【' + state.seats[owner].name + '】获得 1 名陪审员支持（' + state.juryTokens[owner] + '/3）');
            break;
          }
        }
        state.logs.push('【' + state.seats[owner].name + '】的【' + r.card.name + '】发动技能【' + sk.name + '】');
      });
    }
    for (let i = 0; i < n; i++) votes[i] = Math.max(0, votes[i]);
    state.votes = votes;
    state.logs.push('审议结果：' + state.seats.map((s, i) => s.name + ' ' + votes[i] + ' 票').join('，'));
    // 陪审团否决胜利判定：任一玩家获得 3 名陪审员支持 → 立即胜诉（跳出常规轮次）
    if (state.juryTokens && Math.max(...state.juryTokens) >= 3) {
      const winner = state.juryTokens.indexOf(Math.max(...state.juryTokens));
      state.logs.push('🕊️ 陪审团否决！【' + state.seats[winner].name + '】说服 3 名陪审员拒绝适用现有法律——立即宣告胜诉');
      finishGame(state, { juryNull: true });
      return;
    }
    beginPostEvent(state);
  }
  /* 丑闻曝光（舆情事件）：目标玩家声誉腐蚀 +1（上限 5），此后每轮票数 -1 */
  function applyScandalEffects(state, targetSeat) {
    if (targetSeat < 0 || targetSeat >= state.seatCount) return;
    const s = state.seats[targetSeat];
    s.scandal = Math.min(5, (s.scandal || 0) + 1);
    state.logs.push('😈 丑闻曝光！【' + s.name + '】声誉受损，丑闻指数 ' + s.scandal + '/5');
  }
  /* 票数最高的对方（平票时随机抽签，避免同一目标被连续针对或可预测）
   * #13 修复：随机源必须用 state.rng（同种子可复现），不能用 Math.random */
  function highestEnemy(votes, owner, n, rng) {
    let bv = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i === owner) continue;
      if (votes[i] > bv) bv = votes[i];
    }
    if (bv === -Infinity) return owner;
    const ties = [];
    for (let i = 0; i < n; i++) {
      if (i !== owner && votes[i] === bv) ties.push(i);
    }
    return ties.length === 1 ? ties[0] : ties[Math.floor((rng || Math.random)() * ties.length)];
  }

  /* ---------------- 本轮排名 ---------------- */
  function doRank(state) {
    state.phase = 'rank';
    const n = state.seatCount;
    const info = state.seats.map((s, i) => {
      const power = state.row.filter(r => !r.removed && r.seat === i).reduce((sum, r) => sum + r.card.cost, 0);
      return { seat: i, votes: state.votes[i], power };
    });
    // 票数 desc → ⊙ 总和 desc → 亮出顺序（座位靠前）高
    info.sort((a, b) => b.votes - a.votes || b.power - a.power || a.seat - b.seat);
    state.rankInfo = info;
    state.roundRank = info.map(x => x.seat);
    state.logs.push('本轮排名：' + state.roundRank.map((s, i) => (i + 1) + '.' + state.seats[s].name).join(' '));
    doSettle(state);
  }
  function doSettle(state) {
    state.phase = 'settle';
    const first = state.roundRank[0];
    const reward = rewardOf(state.round);
    // 差额计分（防滚雪球）：第一名 +reward，之后每名 -1（最低 +1）→ 落后方不白卷
    state.rankInfo.forEach((info, idx) => {
      const s = state.seats[info.seat];
      let r = Math.max(1, reward - idx);
      if (idx === 0 && state.supportBuff[first]) r += state.supportBuff[first];
      s.support += r;
      if (idx === 0) s.stats.roundsWon++;
      state.logs.push('【' + s.name + '】排名第 ' + (idx + 1) + '，陪审团倾向 +' + r + '（累计 ' + s.support + '）');
    });
    state.supportReward = reward + (state.supportBuff[first] || 0);
    // 连任计数（恐惧税：连续 2 轮第一，下轮刷新成本 +1）
    if (state.prevFirst === first) state.leaderStreak = (state.leaderStreak || 0) + 1;
    else state.leaderStreak = 1;
    state.prevFirst = first;
    // 结算后技能（some voters' skills trigger here）
    state.row.forEach(r => {
      if (r.removed || !r.card.skill) return;
      const sk = SKILLS[r.card.skill];
      if (sk.when !== 'post') return;
      const owner = r.seat;
      if (r.card.skill === 'donor') {
        state.seats[owner].money += 1;
        state.logs.push('【' + state.seats[owner].name + '】的【胜诉酬金】+1⊙');
      } else if (r.card.skill === 'buyback') {
        const t = highestEnemy(state.votes, owner, state.seatCount, state.rng);
        state.seats[t].money = Math.max(0, state.seats[t].money - 1);
        state.logs.push('【' + state.seats[owner].name + '】的【收买证词】使【' + state.seats[t].name + '】-1⊙');
      } else if (r.card.skill === 'whistleblower') {
        // 内部吹哨人：丑闻最高的对方 -1⊙ 且丑闻 +1（瑟皮科扳倒系统）
        const t = highestEnemy(state.votes, owner, state.seatCount, state.rng);
        state.seats[t].money = Math.max(0, state.seats[t].money - 1);
        applyScandalEffects(state, t);
        state.logs.push('📢 内部吹哨人：【' + state.seats[owner].name + '】的线人曝光【' + state.seats[t].name + '】内部腐败（-1⊙ +丑闻）');
      }
    });
    // 角色被动：小镇市长每轮结束 +1⊙
    state.seats.forEach(s => {
      if (s.char && s.char.skill.type === 'roundMoney') { s.money += s.char.skill.v; }
    });
    beginDiscard(state);
  }

  /* ---------------- 整理（保留本阵营 2 张，其余洗入牌堆） ---------------- */
  function beginDiscard(state) {
    state.phase = 'discard';
    state.discardSeat = -1;
    // 被【移除】的牌已在证据排除结算时进档案；其余洗回牌堆
    state.row.forEach(r => { if (!r.removed) state.used.push(r.card); });
    state.row = [];
    state.seats.forEach(s => { s.keepDone = false; s.played = []; });
    // 找到第一个手牌>0 且未保留的玩家
    const next = nextKeepSeat(state);
    state.discardSeat = next;
    if (next >= 0) {
      state.turn = next;
      state.logs.push('整理阶段：' + state.seats[next].name + ' 请保留最多 ' + keepMaxOf(state.seats[next]) + ' 份证据（其余归档）');
    }
  }
  function keepMaxOf(s) {
    return 2 + ((s.char && s.char.skill.type === 'keepPlus') ? s.char.skill.v : 0);
  }
  function nextKeepSeat(state) {
    for (let i = 0; i < state.seatCount; i++) {
      const s = state.seats[i];
      if (!s.keepDone && s.hand.length > 0) return i;
    }
    return -1;
  }
  function keepCard(state, s, uid) {
    if (state.phase !== 'discard' || state.discardSeat !== s.seat) return { ok: false, msg: '还没轮到你整理' };
    const card = s.hand.find(c => c.uid === uid);
    if (!card) return { ok: false, msg: '手牌不存在' };
    const keepMax = keepMaxOf(s);
    if (s.keepUids && s.keepUids.length >= keepMax) return { ok: false, msg: '最多保留 ' + keepMax + ' 张' };
    s.keepUids = s.keepUids || [];
    if (s.keepUids.indexOf(uid) >= 0) { s.keepUids = s.keepUids.filter(x => x !== uid); return { ok: true }; }
    s.keepUids.push(uid);
    return { ok: true };
  }
  function finishKeep(state, s) {
    if (state.phase !== 'discard' || state.discardSeat !== s.seat) return { ok: false, msg: '还没轮到你' };
    const keepMax = keepMaxOf(s);
    const kept = s.keepUids || [];
    if (kept.length < Math.min(keepMax, s.hand.length)) return { ok: false, msg: '请先选择要保留的证据' };
    // 未保留的手牌洗入牌堆
    const rest = s.hand.filter(c => kept.indexOf(c.uid) < 0);
    state.used.push(...rest);
    s.hand = s.hand.filter(c => kept.indexOf(c.uid) >= 0);
    s.keepDone = true;
    s.keepUids = [];
    state.logs.push(s.name + ' 保留了 ' + kept.length + ' 份证据');
    const next = nextKeepSeat(state);
    state.discardSeat = next;
    state.turn = next;
    if (next >= 0) state.logs.push('整理阶段：' + state.seats[next].name + ' 请保留最多 ' + keepMaxOf(state.seats[next]) + ' 份证据');
    return { ok: true };
  }

  /* ---------------- 分发每轮 ⊙ ---------------- */
  function beginIncome(state) {
    state.phase = 'income';
    const prevRank = state.rankInfo;
    const hasPrev = prevRank && prevRank.length > 0;
    const first = hasPrev ? prevRank[0].seat : -1;
    const last = hasPrev ? prevRank[prevRank.length - 1].seat : -1;
    const tax = hasPrev && state.leaderStreak >= 2 ? 1 : 0;   // 连任恐惧税：下轮刷新起点 +1
    const base = incomeOf(state.round);                        // 固定 2
    state.seats.forEach((s, i) => {
      const pbonus = (s.personality && s.personality.bonus && s.personality.bonus.money) || 0;
      let amt = base + pbonus;
      if (!hasPrev) amt += 2;       // 第 1 轮无排名：全体 +4 启动资金
      else {
        if (i === first) amt -= 1;  // 领先税：榜首 -1⊙（政治资本消耗）
        if (i === last) amt += 1;   // 保底酬金：末位 +1⊙（胜诉基金）
      }
      // 收入保底：每轮至少 +1⊙（榜首 -1 时也不会白板回合）
      const pay = Math.max(1, amt);
      s.money += pay;
      state.logs.push('💰 【' + s.name + '】发放律师费 +' + pay + '⊙（累计 ' + s.money + '⊙）');
    });
    state.logs.push(hasPrev
      ? '第 ' + state.round + ' 轮结束，发放律师费（榜首 -1⊙ / 末位 +1⊙）' + (tax ? '，连任榜首更换证物架成本 +1' : '')
      : '第 ' + state.round + ' 轮结束，发放启动酬金 +4⊙');
    // 轮末：市场未买牌洗回，锁定牌留作下轮
    state.seats.forEach((s, i) => {
      s.lastLockedUids = s.lockedUids.slice();
      const kept = s.market.filter(c => s.lockedUids.indexOf(c.uid) >= 0);
      const rest = s.market.filter(c => s.lockedUids.indexOf(c.uid) < 0);
      state.used.push(...rest);
      s.market = kept.slice();
      s.lockedUids = [];
      // 重置每轮状态
      s.buyDone = false; s.playDone = false; s.eventCount = 0; s.eventPassed = false; s.buyUsed = false;
      s.refreshUsed = false;
      s.refreshCost = (tax && i === first) ? 2 : 1;   // 连任恐惧税：榜首下轮刷新起点 +1
    });
    state.voteMod = new Array(state.seatCount).fill(0);
    state.supportBuff = new Array(state.seatCount).fill(0);
  }
  function finishGame(state, opts) {
    opts = opts || {};
    const n = state.seatCount;
    state.gameOver = true;
    // 胜利路径 1：陪审团否决（立即胜诉，已由 doCountContinue 直接触发）
    if (opts.juryNull) {
      const winner = (state.juryTokens || []).indexOf(Math.max(...(state.juryTokens || [])));
      state.winner = winner >= 0 ? winner : 0;
      state.winType = 'juryNull';
      state.logs.push('🕊️ 陪审团否决裁定生效：人民拒绝适用恶法');
      state.logs.push('🏆 ' + state.seats[state.winner].name + ' 胜诉！（陪审团否决）');
      return;
    }
    // 胜利路径 2：先例胜利——触发"确立先例"的一方即使票数落后也直接获胜
    if (state.precedentSeat !== undefined && state.precedentSeat >= 0) {
      state.winner = state.precedentSeat;
      state.winType = 'precedent';
      state.logs.push('⚖️ 先例胜利：虽然票数落后，但【' + state.seats[state.winner].name + '】的辩护已确立判例，后世将以此为准');
      state.logs.push('🏆 ' + state.seats[state.winner].name + ' 胜诉！（先例胜利）');
      return;
    }
    // 胜利路径 3（默认）：无特殊情况第五轮结算后按照倾向判定胜者
    // 平衡修复（#48 千局测试发现）：平局不再按座位号偏袒（原 a.seat-b.seat 让座位 0 吃掉 91.9% 平局），
    // 改用种子 RNG 随机抽签——确定可复现且对所有座位公平。
    const maxSupport = Math.max(...state.seats.map(s => s.support));
    const tied = state.seats.filter(s => s.support === maxSupport);
    if (tied.length > 1) {
      const pick = tied[Math.floor(state.rng() * tied.length)];
      state.winner = pick.seat;
    } else {
      state.winner = state.seats.find(s => s.support === maxSupport).seat;
    }
    state.winType = 'support';
    state.logs.push('最终陪审团倾向：' + state.seats.map((s, i) => s.name + ' ' + s.support).join('，'));
    state.logs.push('🏆 ' + state.seats[state.winner].name + ' 胜诉！');
  }

  /* ---------------- 玩家动作 ---------------- */
  function apply(state, seat, action) {
    if (seat < 0 || seat >= state.seats.length) return { ok: false, msg: '非法座位' };
    const s = state.seats[seat];
    if (!action || !action.type) return { ok: false, msg: '未知操作' };
    const msgs = [];
    let res = { ok: true };
    switch (action.type) {
      case 'pickChar': {
        if (state.phase !== 'pickChar' || s.char) return { ok: false, msg: '当前不能选择角色' };
        const cand = (state.draftCandidates[seat] || []).find(c => c.id === action.charId);
        if (!cand) return { ok: false, msg: '非法角色' };
        s.char = cand;
        s.camp = cand.camp;
        if (cand.skill.type === 'startMoney') s.money += cand.skill.v;
        msgs.push(s.name + ' 选择了【' + cand.name + '】');
        break;
      }
      case 'pickStarter': {
        if (state.phase !== 'chooseStarter') return { ok: false, msg: '当前不是选择起始玩家阶段' };
        if (state.starterChosen) return { ok: false, msg: '起始玩家已选定，不能重复指定' };
        if (state.starterPicker !== seat) return { ok: false, msg: '不由你选择起始玩家' };
        if (action.starterSeat === undefined || action.starterSeat < 0 || action.starterSeat >= state.seatCount) return { ok: false, msg: '非法选择' };
        state.startingSeat = action.starterSeat;
        state.starterChosen = true;
        msgs.push(s.name + ' 指定【' + state.seats[action.starterSeat].name + '】开始本轮');
        break;
      }
      case 'buyCard': {
        res = buyCard(state, s, action.uid);
        break;
      }
      case 'lockCard': {
        res = lockCard(state, s, action.uid);
        break;
      }
      case 'refreshMarket': {
        res = refreshMarket(state, s);
        break;
      }
      case 'endBuy': {
        if (state.phase !== 'buy' || s.buyDone) return { ok: false, msg: '当前不能结束取证' };
        s.buyDone = true;
        msgs.push(s.name + ' 完成取证');
        break;
      }
      case 'playCards': {
        res = playCards(state, s, action.uids || []);
        break;
      }
      case 'finishPlay': {
        res = finishPlay(state, s);
        break;
      }
      case 'terroristTarget': {
        if (state.phase !== 'reveal') return { ok: false, msg: '当前没有待选的恐怖分子目标' };
        if (state.revealPending && state.revealPending.owner !== seat) return { ok: false, msg: '不由你选择目标' };
        res = resolveTerrorist(state, action.targetUid);
        break;
      }
      case 'swapTarget': {
        if (state.phase !== 'count') return { ok: false, msg: '当前没有待选的换位目标' };
        if (state.swapPending && state.swapPending.owner !== seat) return { ok: false, msg: '不由你选择换位目标' };
        res = resolveSwap(state, action.targetUid);
        break;
      }
      case 'playEvent': {
        res = playEvent(state, s, action.uid, action.targetSeat);
        break;
      }
      case 'passEvent': {
        if (state.phase !== 'preEvent' && state.phase !== 'postEvent') return { ok: false, msg: '当前不是事件阶段' };
        if (state.eventTurnSeat !== seat) return { ok: false, msg: '还没轮到你' };
        res = passEvent(state, s);
        break;
      }
      case 'keepCard': {
        res = keepCard(state, s, action.uid);
        break;
      }
      case 'finishKeep': {
        res = finishKeep(state, s);
        break;
      }
      case 'continue': {
        // 结算屏/结束屏继续
        break;
      }
      default: return { ok: false, msg: '未知操作' };
    }
    if (!res.ok) return res;
    if (msgs.length) state.logs.push(...msgs);
    advance(state);
    return { ok: true, msgs, combo: res.combo === true };
  }

  /* ---------------- AI 决策 ---------------- */
  function aiAct(state, seat) {
    const s = state.seats[seat];
    if (!s || state.gameOver) return { ok: false, msg: '游戏已结束' };
    const msgs = [];
    switch (state.phase) {
      case 'pickChar': {
        if (!s.char) {
          const cands = state.draftCandidates[seat] || [];
          if (cands.length) {
            const v = c => ({ startMoney: 2, buyDiscount: 1.5, refreshDiscount: 1, drawPlus: 1.5, votePlus: 1.5, lockPlus: 0.8, eventBuff: 1.2, postMoney: 1, keepPlus: 0.8, roundMoney: 1.5, firstRefreshFree: 1 }[c.skill.type] || 0);
            cands.sort((a, b) => v(b) - v(a));
            s.char = cands[0];
            s.camp = s.char.camp;
            if (s.char.skill.type === 'startMoney') s.money += s.char.skill.v;
          }
        }
        break;
      }
      case 'chooseStarter': {
        if (state.starterPicker === seat) {
          state.startingSeat = seat;
          state.starterChosen = true;
          state.logs.push('排名最低的【' + s.name + '】选择自己开始');
        }
        break;
      }
      case 'buy': {
        if (!s.buyDone) {
          aiBuy(state, s);
          s.buyDone = true;
        }
        break;
      }
      case 'play': {
        if (state.turn === seat && !s.playDone) aiPlay(state, s);
        break;
      }
      case 'reveal': {
        if (state.revealPending && state.revealPending.owner === seat) {
          const targets = state.row.filter(r => r.revealed && r.seat !== seat && !r.removed);
          if (targets.length) {
            // 选对手最"重"的牌（cost 最高）炸
            targets.sort((a, b) => b.card.cost - a.card.cost || b.card.votes - a.card.votes);
            resolveTerrorist(state, targets[0].card.uid);
          } else {
            state.revealPending = null;
          }
        }
        break;
      }
      case 'count': {
        // 政治操盘：选对手票数最高的牌换到自己这张牌旁（改变邻位博弈）
        if (state.swapPending && state.swapPending.owner === seat) {
          const cands = state.row.filter(x => state.swapPending.candidates.indexOf(x.card.uid) >= 0 && x.seat !== seat);
          cands.sort((a, b) => (b.card.votes || 1) - (a.card.votes || 1) || b.card.cost - a.card.cost);
          let t = cands[0];
          if (!t) t = state.row.find(x => state.swapPending.candidates.indexOf(x.card.uid) >= 0);
          if (t) resolveSwap(state, t.card.uid);
          else state.swapPending = null;
        }
        break;
      }
      case 'preEvent':
      case 'postEvent': {
        if (state.eventTurnSeat === seat) aiEvents(state, s);
        break;
      }
      case 'discard': {
        if (state.discardSeat === seat && !s.keepDone) {
          s.keepUids = [];
          if (s.hand.length) {
            // 保留契合当前选区文化 + 人格偏好的强牌（最多 keepMax 张）
            const sorted = s.hand.slice().sort((a, b) => aiCardScore(state, b, s.seat) - aiCardScore(state, a, s.seat));
            s.keepUids = sorted.slice(0, Math.min(keepMaxOf(s), s.hand.length)).map(c => c.uid);
          }
          finishKeep(state, s);
        }
        break;
      }
    }
    advance(state);
    return { ok: true, msgs };
  }

  /* AI 卡牌评分：数值 + 技能（SK_VAL 表）+ 丑闻减分 */
  function aiCardScore(state, c, seat) {
    return (c.votes || 1) + skillVal(c.skill) - (c.scandal || 0) * 0.8;
  }

  /* AI 购买：买高价值牌，市场差则刷新，好牌买不起则锁定 */
  function aiBuy(state, s) {
    const val = c => (c.votes || 1) * 1.5 + skillVal(c.skill)
      - (c.scandal || 0) * 0.6 - buyCostOf(s, c) * 0.4;
    for (let guard = 0; guard < 8; guard++) {
      if (s.money < 1) break;
      const buyable = s.market.filter(c => buyCostOf(s, c) <= s.money);
      if (!buyable.length) break;
      buyable.sort((a, b) => val(b) - val(a));
      const best = buyable[0];
      if (val(best) < 0.8 && s.hand.length >= 4) break;
      if (buyCard(state, s, best.uid).ok) continue;
      break;
    }
    // 锁定：市场有高价值牌但暂时买不起（或刷新后保留）
    if (s.lockedUids.length < lockMax(s) && s.market.some(c => s.lastLockedUids.indexOf(c.uid) < 0 && (c.votes || 1) >= 2)) {
      const good = s.market.filter(c => s.lastLockedUids.indexOf(c.uid) < 0 && (c.votes || 1) >= 2).sort((a, b) => b.votes - a.votes)[0];
      if (good && (good.cost > s.money || s.hand.length < 3)) lockCard(state, s, good.uid);
    }
    // 刷新：手牌少且市场差（经济型人格更愿刷新；弱卡 = 单票 + 低价值技能 + 不便宜）
    if (s.hand.length < 2 && s.market.length) {
      const weak = s.market.every(c => (c.votes || 1) === 1 && skillVal(c.skill) <= 1.6 && (c.cost || 1) >= 2);
      // 经济型人格更愿刷新（per 即 s.personality；此处修复历史未定义引用）
      const threshold = (s.personality && s.personality.economy >= 0.7) ? 3 : 2;
      if (weak && s.hand.length < threshold && refreshCostOf(s) <= s.money) refreshMarket(state, s);
    }
  }

  /* AI 出牌：新规则每回合只打 1 张（评分最高）；温和人格更可能保留战略，激进人格打完 */
  function aiPlay(state, s) {
    if (s.playDone) return;
    const hand = s.hand.slice().sort((a, b) => aiCardScore(state, b, s.seat) - aiCardScore(state, a, s.seat));
    if (!hand.length) { s.playDone = true; return; }
    const agg = (s.personality && s.personality.aggression !== undefined) ? s.personality.aggression : 0.5;
    const keepChance = (1 - agg) * 0.3; // 温和人格保留战略
    if (state.rng() < keepChance && hand.length > 1) { s.playDone = true; return; }
    playCards(state, s, [hand[0].uid]);
  }

  /* 全局事件（scandalAll）对 AI 的价值评估：>0 则对己方有利 */
  function aiAutoValue(state, s, ev) {
    const e = ev.eff;
    if (e.type === 'scandalAll') {
      let maxOther = 0;
      state.seats.forEach((x, i) => { if (i !== s.seat) maxOther = Math.max(maxOther, x.scandal); });
      return maxOther - s.scandal;
    }
    return 0;
  }

  /* AI 事件：依据人格 aggression 选择攻击/增益事件；全局 auto 事件经价值评估后才打 */
  function aiEvents(state, s) {
    const agg = (s.personality && s.personality.aggression !== undefined) ? s.personality.aggression : 0.5;
    for (let i = 0; i < 2; i++) {
      const usable = usableEvents(state, s);
      if (!usable.length) break;
      const selfEv = usable.find(e => e.target === 'self');
      const enemyEv = usable.find(e => e.target === 'enemy');
      const autoCands = usable.filter(e => e.target === 'auto' && aiAutoValue(state, s, e) > 0)
        .sort((a, b) => aiAutoValue(state, s, b) - aiAutoValue(state, s, a));
      const goodAuto = autoCands[0];
      let ev;
      if (agg >= 0.7) {
        // 激进人格（MAGA/茶党）：优先攻击对手
        ev = enemyEv || goodAuto || selfEv;
      } else if (agg >= 0.5) {
        // 平衡人格：先打正价值全局事件，再考虑增益/攻击
        ev = goodAuto || selfEv || enemyEv;
      } else {
        // 温和人格（自由意志/永不特朗普）：优先增益自己，auto 次之，攻击仅偶尔
        ev = selfEv || goodAuto || (enemyEv && state.rng() < 0.3 ? enemyEv : null);
      }
      if (!ev) break;
      let tgt;
      if (ev.target === 'enemy') {
        // 选当前最高票/最高倾向的对手
        const scores = state.seats.map((x, i) => (state.votes && state.votes[i]) || x.support);
        tgt = highestEnemy(scores, s.seat, state.seatCount, state.rng);
      }
      if (!playEvent(state, s, ev.uid, tgt).ok) break;
      // playEvent 已推进 eventTurnSeat
      if (state.eventTurnSeat !== s.seat) return;
    }
    if (state.eventTurnSeat === s.seat) passEvent(state, s);
  }

  /* ---------------- 服务端/渲染器辅助 ---------------- */
  /* 每个阶段"谁需要输入"统一由 PHASES 表（engine/04-advance.js）判定，
   * 本文件只按 AI/人类筛选座位，杜绝双份 switch（评审四/五：单一来源）。 */
  function needsAIAction(state) {
    if (!state || state.gameOver) return [];
    const list = [];
    const def = PHASES[state.phase];
    state.seats.forEach((s, i) => {
      const isAI = s.isAI || !s.connected;
      if (!isAI) return;
      if (def && def.needsInput(state, i)) list.push(i);
    });
    return list;
  }
  function humanActing(state) {
    if (!state || state.gameOver) return [];
    const list = [];
    const def = PHASES[state.phase];
    state.seats.forEach((s, i) => {
      if (s.isAI || !s.connected) return;
      if (def && def.needsInput(state, i)) list.push(i);
    });
    return list;
  }
  /* 阶段流转唯一源（超级更新#2）：全部 15 个 phase 按真实流转顺序。
   * 两端进度条 / UIPresenter.phaseIndex 一律引用本常量，禁止另写副本。 */
  const PHASE_STEPS = [
    ['pickChar', '抽取角色'],
    ['chooseStarter', '起始'],
    ['drawEvent', '抽事件'],
    ['drawVoter', '发选民'],
    ['buy', '取证'],
    ['play', '举证'],
    ['reveal', '亮出'],
    ['preEvent', '前庭审'],
    ['count', '审议'],
    ['postEvent', '后庭审'],
    ['rank', '排名'],
    ['settle', '结算'],
    ['discard', '整理'],
    ['income', '酬金'],
    ['gameover', '终局']
  ];
  /* 进度条显示用：过滤瞬时自动阶段（无玩家操作），与历史 10 步展示一致 */
  const PHASE_STEPS_VISIBLE = PHASE_STEPS.filter(s => !['pickChar', 'drawEvent', 'drawVoter', 'settle', 'income'].includes(s[0]));
  function phaseLabel(state) {
    const map = {
      pickChar: '抽取角色', chooseStarter: '决定起始玩家', drawEvent: '抽取事件牌', drawVoter: '抽取证据',
      buy: '调查取证', play: '暗置举证', reveal: '亮出证据', preEvent: '庭审前·事件', count: '审议中',
      postEvent: '庭审后·事件', rank: '本轮排名', settle: '本轮结算', discard: '整理', income: '发放酬金', gameover: '游戏结束'
    };
    return map[state.phase] || state.phase;
  }
  /* 可点击卡牌（供渲染器高亮） */
  function myClickable(state, seat) {
    const s = state.seats[seat];
    const out = { market: [], hand: [], events: [], targets: [], chars: [] };
    if (!s) return out;
    switch (state.phase) {
      case 'pickChar':
        out.chars = (state.draftCandidates[seat] || []).map(c => c.id);
        break;
      case 'buy':
        if (!s.buyDone) { out.market = s.market.map(c => c.uid); }
        break;
      case 'play':
        if (state.turn === seat && !s.playDone) { out.hand = s.hand.map(c => c.uid); }
        break;
      case 'reveal':
        if (state.revealPending && state.revealPending.owner === seat) {
          out.targets = state.row.filter(r => r.revealed && r.seat !== seat && !r.removed).map(r => r.card.uid);
        }
        break;
      case 'count':
        if (state.swapPending && state.swapPending.owner === seat) {
          out.targets = state.swapPending.candidates.slice();
        }
        break;
      case 'preEvent':
      case 'postEvent':
        if (state.eventTurnSeat === seat) { out.events = usableEvents(state, s).map(e => e.uid); }
        break;
      case 'discard':
        if (state.discardSeat === seat && !s.keepDone) { out.hand = s.hand.map(c => c.uid); }
        break;
    }
    return out;
  }

  return {
    createGame, apply, aiAct, advance,
    needsAIAction, humanActing, phaseLabel, myClickable,
    PHASE_STEPS, PHASE_STEPS_VISIBLE,
    PHASES,   // 状态描述表（评审四：每个阶段自包含 label/needsInput/update）
    buyCostOf, refreshCostOf, eventLvMax, incomeOf, rewardOf, marketSize,
    data: { CHARACTERS, VOTER_TEMPLATES, EVENT_TEMPLATES, SKILLS, CAMPS, AI_PERSONALITIES },
    mulberry32,
    doCountContinue,   // 测试钩子：仅用于单元测试直调结算（不影响任何运行路径）
    finishGame, beginIncome  // 测试钩子：终局判定 / 收入发放（供单测直调）
  };
});
