/* 一次性修复脚本：还原 theme.js 中被误替换的空字符串引号 */
const fs = require('fs');
const p = 'shared/theme.js';
let t = fs.readFileSync(p, 'utf8');
t = t.replace("replace('#', ')", "replace('#', '')");
fs.writeFileSync(p, t);
console.log('fixed: replace empty string quote');
