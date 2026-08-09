/* ============================================================
 * shared/ui-kit.js — 卡牌积木（StS 式信息架构）
 * ------------------------------------------------------------
 * 单一事实源：client.js 直接 <script src="/shared/ui-kit.js"> 引用；
 * singleplayer.html 由 _build_ui.js 自动内联。
 * 所有绘制原语（drawPixelText/pxRect/...）通过环境注入，
 * 默认回退到全局同名函数——双端永不漂移。
 *
 * 卡面信息架构（杀戮尖塔式三要素，详情进悬停）：
 *   ① 票数 → 左上角巨型金徽（费用位）
 *   ② 名字 → 顶部大字（电影海报式，fitText 截断）
 *   ③ 技能 → 中央大徽章（图标占卡宽 64%）+ 技能名小字
 *   ④ 价格 → 底部金条
 *   阵营色带保留（o.seat）；铁证 → 绿色 ⚖ 徽章。
 *   想改卡面任何元素的位置/大小：只改 planCard()。
 * ============================================================ */
(function (global) {
  'use strict';

  /* 技能 → 徽章图标（emoji，canvas 矢量字体可渲染） */
  const SKILL_ICON = {
    fan: '⭐', troll: '🖤', orator: '🎤', scandal: '📰', wave: '🌊',
    idol: '🌟', megaScandal: '💣', comeback: '🔥', pivot: '🎲', donor: '💰',
    buyback: '💵', terrorist: '🚫', swap: '🔄', shiftLeft: '⬅️', shiftRight: '➡️',
    counsel: '🤝', flank: '⚔️', poach: '🪤', rally: '📣', tagBoost: '🎯',
    tagHate: '🛑', edge: '📍', rowL: '◀️', rowR: '▶️', leftFoe: '👈',
    rightFoe: '👉', majority: '📈', minority: '📉', shame: '😈', threat: '👑',
    crossExam: '🔍', objection: '⚡', reasonableDoubt: '🧤', timelineSnipe: '🕰️',
    flipNarrative: '♻️', careerGamble: '🎰', credCollapse: '💔', whistleblower: '🚨',
    precedent: '🏛️', juryNull: '🕊️', firstSeat: '🥇', lastSeat: '🏁',
    leftWall: '🧱', randomHit: '🎴'
  };

  /* 投票人身份标签（两字文本，唯一源：替代旧 VOTER_ICON emoji 死代码，卡面身份层） */
  const VOTER_TAG = {
    v01: '学生', v02: '老兵', v03: '骑手', v04: '主妇', v05: '教友',
    v06: '工人', v07: '码农', v08: '教授', v09: '创投', v10: '维权',
    v11: '沉默', v12: '忠诚', v13: '王牌', v14: '反证', v15: '狂热',
    v16: '抹黑', v17: '雄辩', v18: '揭短', v19: '舆情', v20: '明星',
    v21: '黑料', v22: '翻盘', v23: '献金', v24: '买票', v25: '乡村',
    v26: '牧师', v27: '工会', v28: '大亨', v29: '旁证', v30: '移民',
    v31: '执事', v32: '学贷', v33: '军人', v34: '店主', v35: '枪协',
    v36: '金主', v37: '教师', v38: '寡头', v39: '游说', v40: '水工',
    v41: '街头', v42: '租户', v43: '农场', v44: '司机', v45: '巡边',
    v46: '义工', v47: '单亲', v48: '主持', v49: '阴谋', v50: '布道',
    v51: '教职', v52: '家长', v53: '疫苗', v54: '跨性', v55: '权益',
    v56: '公诉', v57: '警长', v58: '质疑', v59: '商家', v60: '保守',
    v61: '社运', v62: '自由', v63: '元老', v64: '环保', v65: '掮客',
    v66: '鼓动', v67: '金融', v68: '社区', v69: '顽固', v70: '摇摆',
    v71: '流浪', v72: '交易', v73: '医护', v74: '主播', v75: '书店',
    v76: '咖啡', v77: '房产', v78: '军商', v79: '歌手', v80: '素食',
    v81: '健身', v82: '数据', v83: '快递', v84: '橄榄', v85: '矿工',
    v86: '护士', v87: '古董', v88: '算法', v89: '并肩', v90: '反水',
    v91: '质证', v92: '反对', v93: '手套', v94: '收据', v95: '原则',
    v96: '豪赌', v97: '伪证', v98: '吹哨', v99: '先例', v100: '人民',
    v101: '首座', v102: '末席', v103: '方阵', v104: '抽签'
  };

  /* 技能 → 飘字 + 触发色（唯一源：双端不再手抄，见 _build_ui 内联） */
  const SKILL_FX = {
    fan: { txt: '+1 票', col: '#0E8A5F' },
    troll: { txt: '敌方 -1', col: '#D82E2F' },
    orator: { txt: '+1 票', col: '#0E8A5F' },
    scandal: { txt: '敌方 -1', col: '#D82E2F' },
    wave: { txt: '+1 / -1', col: '#1E4FB5' },
    idol: { txt: '+2 票', col: '#E8A418' },
    megaScandal: { txt: '敌方 -2', col: '#D82E2F' },
    comeback: { txt: '翻盘 +1', col: '#E8A418' },
    donor: { txt: '+1 ⊙', col: '#E8A418' },
    buyback: { txt: '敌方 -1⊙', col: '#D82E2F' },
    terrorist: { txt: '排除证据', col: '#7A0E0E' },
    swap: { txt: '换位', col: '#FFD60A' },
    shiftLeft: { txt: '左移', col: '#FFD60A' },
    shiftRight: { txt: '右移', col: '#FFD60A' },
    counsel: { txt: '同盟 +1', col: '#0E8A5F' },
    flank: { txt: '连坐 -1', col: '#D82E2F' },
    poach: { txt: '连坐挖票', col: '#E8A418' },
    rally: { txt: '声援 +1', col: '#0E8A5F' },
    pivot: { txt: '反超 +2', col: '#E8A418' },
    tagBoost: { txt: '共鸣 +1', col: '#1E4FB5' },
    tagHate: { txt: '压制 -1', col: '#D82E2F' },
    edge: { txt: '端点 +1', col: '#E8A418' },
    rowL: { txt: '左席 +1', col: '#1E4FB5' },
    rowR: { txt: '右席 +1', col: '#1E4FB5' },
    leftFoe: { txt: '左敌 -1', col: '#D82E2F' },
    rightFoe: { txt: '右敌 -1', col: '#D82E2F' },
    majority: { txt: '领先 +1', col: '#0E8A5F' },
    minority: { txt: '反扑 +1', col: '#E8A418' },
    shame: { txt: '借题 +1', col: '#E8A418' },
    threat: { txt: '对垒 -1', col: '#D82E2F' },
    crossExam: { txt: '质证 -1', col: '#D82E2F' },
    objection: { txt: '反对! -1', col: '#7A0E0E' },
    reasonableDoubt: { txt: '合理怀疑 -2', col: '#E8A418' },
    timelineSnipe: { txt: '时间线 -1', col: '#E8A418' },
    flipNarrative: { txt: '翻转 +2', col: '#E8A418' },
    careerGamble: { txt: '豪赌 +2', col: '#E8A418' },
    credCollapse: { txt: '崩塌 -1', col: '#D82E2F' },
    whistleblower: { txt: '吹哨 -1⊙', col: '#D82E2F' },
    precedent: { txt: '先例 +1', col: '#7B4FC9' },
    juryNull: { txt: '陪审员 +1', col: '#7B4FC9' },
    firstSeat: { txt: '首座 -1', col: '#D82E2F' },
    lastSeat: { txt: '末席 -1', col: '#D82E2F' },
    leftWall: { txt: '左翼 +N', col: '#1E4FB5' },
    randomHit: { txt: '随机 -1', col: '#E8A418' }
  };

  /* 主题读取：唯一源在 shared/theme.js（已挂 window/globalThis，超级更新#3），
   * 此处不再需要 setEnv 显式注入，直接读 global。 */
  function E(name, fallback) {
    if (global[name] !== undefined) return global[name];
    return fallback;
  }

  /* ---------------- 布局引擎：唯一的坐标决策点 ---------------- */
  function planCard(x, y, w, h) {
    const ratio = w / h;
    const mini = w < 70 || h < 62 || ratio < 0.52;          // 迷你：名字+票数+价格
    const small = !mini && (w < 116 || h < 96 || ratio < 0.8); // 小档：技能图标小字+条
    const pad = 4;
    const vbW = Math.min(48, w * 0.36);
    const vbH = Math.min(20, h * 0.2);
    const nameSize = Math.max(9, Math.min(h * (mini ? 0.10 : 0.14), 22));
    const badgeSize = Math.max(14, Math.min(h * 0.28, 40));
    return {
      mini, small, ratio,
      voteBadge: { x: x + pad, y: y + pad, w: vbW, h: vbH },
      name: { x: x + vbW + 8, y: y + h * (mini ? 0.04 : 0.06), w: w - vbW - 14, h: nameSize * 1.4, size: nameSize },
      skillBadge: { x, y: y + h * (mini ? 0.5 : 0.34), w, h: badgeSize * 1.6, size: badgeSize },
      skillName: { x, y: y + h * (small ? 0.52 : 0.74), w, h: Math.max(14, h * 0.08), size: Math.max(8, Math.min(h * 0.07, 13)) },
      cost: { x: x + w / 2 - Math.min(30, w * 0.25), y: y + h - 20, w: Math.min(60, w * 0.5), h: 16, size: Math.max(10, h * 0.082) },
      camp: { x, y: y + 1, w: 3, h: h - 2 }
    };
  }

  /* ---------------- 卡背（唯一源：由双端抽入，超级更新#5） ---------------- */
  function drawCardBackAt(ctx, x, y, w, h, col) {
    const shadow = E('comicShadow'), rect = E('pxRect'), border = E('pxBorder'), text = E('drawPixelText');
    const PAL = E('PAL') || {};
    const bc = col || (PAL.ui && PAL.ui.b) || '#14213D';
    shadow(x, y, w, h, 3, 3);
    rect(x, y, w, h, '#222222');
    border(x, y, w, h, bc, 2.5);
    rect(x + w * 0.18, y + h * 0.16, w * 0.64, h * 0.68, 'rgba(255,255,255,0.08)');
    text('?', x + w / 2, y + h / 2, h * 0.36, bc, { align: 'center', shadow: false });
  }

  /* ---------------- 组装：drawCard（供 drawVoterCard 薄封装调用） ---------------- */
  function drawCard(ctx, x, y, w, h, card, o) {
    o = o || {};
    const text = E('drawPixelText'), rect = E('pxRect'), border = E('pxBorder'),
          shadow = E('comicShadow'), fit = E('fitText'), camp = E('campColor'),
          lv = E('lvMark'), PAL = E('PAL') || {};
    const core = E('ElectionCore');
    const skills = (core && core.data) ? core.data.SKILLS : null;
    if (card.hidden) {
      drawCardBackAt(ctx, x, y, w, h, o.backCol || (PAL.ui && PAL.ui.b) || '#14213D');
      return;
    }

    const col = o.col || '#f6e9c8';
    const lay = planCard(x, y, w, h);

    shadow(x, y, w, h, 3, 3);
    rect(x, y, w, h, col);
    border(x, y, w, h, '#111111', 2);

    // 阵营色带（o.seat 提供时）
    if (o.seat !== undefined && o.seat >= 0) {
      rect(x, y + 1, 3, h - 2, camp(o.seat));
      border(x, y + 1, 3, h - 2, '#111111', 1);
    }

    // ① 票数金徽（左上，StS 费用位）
    const vb = lay.voteBadge;
    rect(vb.x, vb.y, vb.w, vb.h, '#111111');
    border(vb.x, vb.y, vb.w, vb.h, '#111111', 1);
    text('⚖' + (card.votes || 1), vb.x + vb.w / 2, vb.y + vb.h / 2, Math.max(10, h * 0.085), '#FFD60A', { align: 'center', shadow: false });

    // ② 名字大字（顶部居中，避开左上徽章）
    const nm = lay.name;
    const nameW = Math.max(22, nm.w - 4);
    const fName = fit(card.name, nameW, nm.size);
    text(fName.text, nm.x + nameW / 2, nm.y + nm.h / 2, fName.size, '#111111', { align: 'center', shadow: false });

    const sk = card.skill ? (skills ? skills[card.skill] : null) : null;
    const icon = card.skill ? (SKILL_ICON[card.skill] || '⚖') : null;

    if (!lay.mini) {
      // ③ 身份标签（两字小字：名字与技能徽章之间）
      const tag = card.id ? VOTER_TAG[card.id] : null;
      if (tag && !lay.small) {
        text(tag, x + w / 2, y + h * 0.30, Math.max(8, h * 0.055), '#8a7a52', { align: 'center', shadow: false });
      }
      const sb = lay.skillBadge;
      if (icon && !lay.small) {
        // ③ 中央大徽章（技能图标，占卡宽 64%）
        const fxc = (SKILL_FX[card.skill] && SKILL_FX[card.skill].col) || '#1E4FB5';
        rect(sb.x + sb.w * 0.18, sb.y, sb.w * 0.64, sb.h, fxc + '44');
        border(sb.x + sb.w * 0.18, sb.y, sb.w * 0.64, sb.h, fxc, 2.5);
        text(icon, sb.x + sb.w / 2, sb.y + sb.h / 2, sb.size, '#FFFFFF', { align: 'center' });
      } else if (icon && lay.small) {
        // 小档：技能图标（无大徽章底，居中偏上）
        const fxc = (SKILL_FX[card.skill] && SKILL_FX[card.skill].col) || '#1E4FB5';
        text(icon, sb.x + sb.w / 2, sb.y + sb.h / 2, Math.max(12, sb.size * 0.6), fxc, { align: 'center', shadow: false });
      } else if (!sk && !lay.small) {
        // 铁证：绿色 ⚖ 徽章
        rect(sb.x + sb.w * 0.18, sb.y, sb.w * 0.64, sb.h, 'rgba(14,138,95,0.5)');
        border(sb.x + sb.w * 0.18, sb.y, sb.w * 0.64, sb.h, '#0E8A5F', 2.5);
        text('⚖', sb.x + sb.w / 2, sb.y + sb.h / 2, sb.size, '#FFFFFF', { align: 'center' });
        text('铁证', sb.x + sb.w / 2, sb.y + sb.h * 0.82, Math.max(9, sb.size * 0.3), '#0E8A5F', { align: 'center', shadow: false });
      }
      // 技能名小字（normal：徽章下方深棕；small：黑底黄字条）
      if (sk) {
        const sn = lay.skillName;
        if (lay.small) {
          rect(x + 4, sn.y, w - 8, sn.h, card.skill === 'terrorist' ? '#7A0E0E' : '#111111');
          text(lv(sk.lv) + sk.name, x + w / 2, sn.y + sn.h / 2, Math.max(9, sn.size), '#FFD60A', { align: 'center', shadow: false });
        } else {
          text(lv(sk.lv) + sk.name, x + w / 2, sn.y + sn.h / 2, sn.size, '#4A3100', { align: 'center', shadow: false });
        }
      }
    }

    // ④ 底部价格金条
    const cb = lay.cost;
    rect(cb.x, cb.y, cb.w, cb.h, '#E8A418');
    border(cb.x, cb.y, cb.w, cb.h, '#111111', 2);
    text('⊙' + card.cost, cb.x + cb.w / 2, cb.y + cb.h / 2, cb.size, '#4A3100', { align: 'center', shadow: false, lineW: 0 });
  }

  /* ---------------- 事件牌（CONFIDENTIAL 机密卡，唯一源） ---------------- */
  function drawEventCard(ctx, x, y, w, h, ev, o) {
    o = o || {};
    const text = E('drawPixelText'), rect = E('pxRect'), border = E('pxBorder'),
          shadow = E('comicShadow'), wrap = E('drawWrapText'), lv = E('lvMark'),
          PAL = E('PAL') || { events: { a: '#14213D', b: '#FFD60A' }, accent: { b: '#111111' }, paper: '#F6E9C8' };
    if (ev.hidden) { drawCardBackAt(ctx, x, y, w, h, '#2A3A5A'); return; }
    const used = ev.used;
    const col = used ? '#5A5A5A' : (o.col || PAL.events.a);
    shadow(x, y, w, h, 3, 3);
    rect(x, y, w, h, col);
    border(x, y, w, h, used ? '#333333' : '#111111', 2);
    // 机密条
    rect(x, y, w, 12, used ? '#444444' : '#7A0E0E');
    text(used ? '已归档' : 'CONFIDENTIAL', x + 4, y + 6, 9, '#FFFFFF', { shadow: false });
    text(lv(ev.lv) + ev.name, x + w / 2, y + h * 0.26, Math.max(10, h * 0.1), used ? '#BBBBBB' : PAL.events.b, { align: 'center', shadow: false });
    const evDescLines = Math.max(1, Math.floor((h * 0.5 - 22) / Math.max(9, h * 0.09)));   // 底部标签之上截断
    wrap(ev.desc, x + 5, y + h * 0.52, Math.max(8.5, h * 0.066), used ? '#999999' : '#FFFFFF', w - 10, Math.max(9, h * 0.09), { maxLines: evDescLines });
    // 效果章
    const effTxt = ev.eff ? (ev.eff.type === 'vote' ? (ev.eff.val > 0 ? '+票' : '−票') : ev.eff.type === 'money' ? (ev.eff.val > 0 ? '+⊙' : '−⊙') : ev.eff.type === 'support' ? '倾向' : '加成') : '';
    const stampCol = ev.eff && ev.eff.val < 0 ? '#E6392F' : '#0E8A5F';
    rect(x + 4, y + h - 18, 46, 14, used ? '#555555' : stampCol);
    text(ev.timing === 'pre' ? '庭审前' : '庭审后', x + 27, y + h - 11, 10, '#FFFFFF', { align: 'center', shadow: false });
    rect(x + w - 50, y + h - 18, 46, 14, used ? '#555555' : '#111111');
    text(effTxt, x + w - 27, y + h - 11, 10.5, used ? '#AAAAAA' : '#FFD60A', { align: 'center', shadow: false });
  }

  /* ---------------- 角色候选卡（3 选 1，唯一源） ---------------- */
  function drawCharCard(ctx, x, y, w, h, ch, col, selected) {
    const text = E('drawPixelText'), rect = E('pxRect'), border = E('pxBorder'),
          shadow = E('comicShadow'), fit = E('fitText'), wrap = E('drawWrapText'),
          contrast = E('contrast'), jag = E('jaggedRectPath'),
          clamp = E('clamp') || ((v, a, b) => Math.max(a, Math.min(b, v))),
          PARTY_META = E('PARTY_META') || {},
          PAL = E('PAL') || { events: { a: '#14213D', b: '#FFD60A' }, accent: { b: '#111111' }, paper: '#F6E9C8' };
    // 美漫硬阴影
    shadow(x, y, w, h, 3, 3);
    rect(x, y, w, h, selected ? PAL.accent.b : PAL.paper);
    border(x, y, w, h, selected ? '#111111' : col, selected ? 4 : 2.5);

    const meta = PARTY_META[ch.camp] || { name: '独立', sym: '?' };

    // 1. 顶部标签：阵营色 + 锯齿手感
    const tagX = x + 8, tagY = y + 8, tagW = 74, tagH = 20;
    ctx.save();
    ctx.lineJoin = 'miter';
    jag(tagX, tagY, tagW, tagH, 2);   // 锯齿小条
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    // 去掉文字描边，利用高对比反色
    text(meta.sym + ' ' + meta.name, x + 45, y + 18, 10, contrast(col), { align: 'center', shadow: false });

    // 2. 角色名：黑底白字反色条（P0：fitText 防长名溢出 + 高度自适应）
    const nameBarY = y + h * 0.28;
    const nameBarH = clamp(h * 0.14, 20, 32);
    rect(x + 6, nameBarY, w - 12, nameBarH, '#111111');
    rect(x + 6, nameBarY + nameBarH - 1, w - 12, 4, col);   // 底下加一条阵营色衬托
    const fN = fit(ch.name, w - 24, Math.max(13, h * 0.125));
    text(fN.text, x + w / 2, nameBarY + nameBarH / 2, fN.size, '#FFFFFF', { align: 'center', shadow: false });

    // 3. 技能描述区：禁止描边，浅色底块（P0：动态高度 + 行数截断）
    const descY = nameBarY + nameBarH + 8;
    const descH = clamp(h - descY - 30, 20, h * 0.24);
    rect(x + 8, descY, w - 16, descH, '#f0e8d8');
    border(x + 8, descY, w - 16, descH, '#111111', 1.5);
    const dSize = Math.max(8.5, Math.min(h * 0.085, 11));
    const dLines = Math.max(1, Math.floor(descH / (dSize * 1.18)));
    wrap(ch.desc, x + 10, descY + descH / 2, dSize, '#333333', w - 20, Math.max(10, dSize * 1.18), { shadow: false, maxLines: dLines });

    // 4. 底部：起始资金，发光效果
    rect(x + 8, y + h - 24, w - 16, 16, '#111111');
    border(x + 8, y + h - 24, w - 16, 16, col, 2);
    text('起始 ⊙ ' + (ch.skill && ch.skill.type === 'startMoney' ? 4 + ch.skill.v : 4), x + w / 2, y + h - 16, 10, '#FFD60A', { align: 'center', shadow: false });
  }

  const UIKit = { SKILL_ICON, SKILL_FX, VOTER_TAG, planCard, drawCard, drawEventCard, drawCharCard, drawCardBackAt };
  global.UIKit = UIKit;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
