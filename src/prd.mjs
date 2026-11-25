// 纯 Node.js（零第三方依赖）PRD 资料解析、五选项状态检查与双端（Figma 单页 + Word .docx）同源生成器
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readZip, writeZip } from './zip.mjs';

/* ============================================================================
 * 1. PNG / JPEG 尺寸探测（纯 Buffer 解析）
 * ========================================================================== */

export function probeImageSize(buf) {
  if (
    Buffer.isBuffer(buf) &&
    buf.length >= 24 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) &&
    buf.subarray(12, 16).toString('ascii') === 'IHDR'
  ) {
    return {
      width: Math.max(1, buf.readUInt32BE(16)),
      height: Math.max(1, buf.readUInt32BE(20)),
      mime: 'image/png',
    };
  }

  if (Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    const sofMarkers = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
    let idx = 2;
    while (idx + 1 < buf.length) {
      if (buf[idx] !== 0xFF) { idx++; continue; }
      while (idx < buf.length && buf[idx] === 0xFF) idx++;
      if (idx >= buf.length) break;
      const marker = buf[idx++];
      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;
      if (idx + 2 > buf.length) break;
      const segLen = buf.readUInt16BE(idx);
      if (segLen < 2 || idx + segLen > buf.length) break;
      if (sofMarkers.has(marker) && idx + 7 <= buf.length) {
        const height = buf.readUInt16BE(idx + 3);
        const width = buf.readUInt16BE(idx + 5);
        return { width: Math.max(1, width), height: Math.max(1, height), mime: 'image/jpeg' };
      }
      idx += segLen;
    }
    return { width: 800, height: 500, mime: 'image/jpeg' };
  }

  return { width: 800, height: 500, mime: 'image/png' };
}

/* ============================================================================
 * 2. XML 辅助与 Word (.docx / .doc) 读取解析
 * ========================================================================== */

function xmlEscape(val) {
  return String(val ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(str) {
  return String(str ?? '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&amp;/g, '&');
}

function extractParagraphText(pXml) {
  let out = '';
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/g;
  let m;
  while ((m = tokenRe.exec(pXml)) !== null) {
    if (m[1] !== undefined) out += xmlUnescape(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else out += '\n';
  }
  return out.trim();
}

const HEADING_RE = /^(?:第[一二三四五六七八九十百0-9]+[章节部分]|[一二三四五六七八九十]+、|[0-9]+(?:\.[0-9]+){0,2}[.、\s])\s*\S+/;

/**
 * 顶层遍历 <w:body> 的直接子节点（<w:p> 与 <w:tbl>），避免表格内 <w:p> 被重复统计为正文段落。
 */
function iterTopLevelBodyNodes(bodyXml) {
  const nodes = [];
  let i = 0;
  const len = bodyXml.length;
  while (i < len) {
    const pIdx = bodyXml.indexOf('<w:p', i);
    const tIdx = bodyXml.indexOf('<w:tbl', i);
    const candidates = [
      pIdx !== -1 ? { type: 'p', idx: pIdx } : null,
      tIdx !== -1 ? { type: 'tbl', idx: tIdx } : null,
    ].filter(Boolean);
    if (!candidates.length) break;
    candidates.sort((a, b) => a.idx - b.idx);
    const pick = candidates[0];

    // 确认标签名边界（避免把 <w:pPr> 或 <w:tblPr> 当成 <w:p>/<w:tbl>）
    const nextChar = bodyXml[pick.idx + 2 + pick.type.length + 1];
    if (nextChar && !/[\s>/]/.test(nextChar)) {
      i = pick.idx + 4;
      continue;
    }

    const openTag = `<w:${pick.type}`;
    const closeTag = `</w:${pick.type}>`;

    // 检查是否自闭合标签 <w:p/>
    const gtPos = bodyXml.indexOf('>', pick.idx);
    if (gtPos !== -1 && bodyXml[gtPos - 1] === '/') {
      nodes.push({ type: pick.type, xml: bodyXml.slice(pick.idx, gtPos + 1) });
      i = gtPos + 1;
      continue;
    }

    // 处理可能的嵌套同名标签（例如表格内嵌表格）
    let depth = 1;
    let cursor = gtPos + 1;
    while (depth > 0 && cursor < len) {
      const nextOpen = bodyXml.indexOf(openTag, cursor);
      const nextClose = bodyXml.indexOf(closeTag, cursor);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const ch = bodyXml[nextOpen + openTag.length];
        if (!ch || /[\s>/]/.test(ch)) {
          const og = bodyXml.indexOf('>', nextOpen);
          if (og !== -1 && bodyXml[og - 1] !== '/') depth++;
        }
        cursor = nextOpen + openTag.length;
      } else {
        depth--;
        cursor = nextClose + closeTag.length;
      }
    }
    nodes.push({ type: pick.type, xml: bodyXml.slice(pick.idx, cursor) });
    i = cursor;
  }
  return nodes;
}

export function inspectWordDocument(docPath, { extractDir = null } = {}) {
  const absDoc = path.resolve(docPath);
  if (!fs.existsSync(absDoc)) throw new Error(`找不到文档：${absDoc}`);

  let targetDocx = absDoc;
  let cleanupDir = null;

  if (path.extname(absDoc).toLowerCase() === '.doc') {
    if (process.platform !== 'darwin') {
      throw new Error('当前非 macOS 环境，无法直接转换旧版 .doc，请先用 Word/WPS 另存为 .docx。');
    }
    cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-doc-'));
    const converted = path.join(cleanupDir, `${path.basename(absDoc, '.doc')}.docx`);
    execFileSync('textutil', ['-convert', 'docx', absDoc, '-output', converted]);
    targetDocx = converted;
  }

  try {
    const zipEntries = readZip(fs.readFileSync(targetDocx));
    const docBuf = zipEntries.get('word/document.xml');
    if (!docBuf) throw new Error(`${absDoc} 不是有效的 .docx 文档（缺少 word/document.xml）`);

    // 1) 解析 styles.xml（styleId -> { name, outlineLvl }）
    const styleMap = new Map();
    const stylesBuf = zipEntries.get('word/styles.xml');
    if (stylesBuf) {
      const sXml = stylesBuf.toString('utf8');
      const styleRe = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
      let sm;
      while ((sm = styleRe.exec(sXml)) !== null) {
        const sid = sm[1];
        const inner = sm[2];
        const nameM = /<w:name\b[^>]*w:val="([^"]+)"/.exec(inner);
        const lvlM = /<w:outlineLvl\b[^>]*w:val="([0-9]+)"/.exec(inner);
        styleMap.set(sid, {
          name: nameM ? xmlUnescape(nameM[1]) : sid,
          outlineLvl: lvlM ? Number(lvlM[1]) + 1 : null,
        });
      }
    }

    // 2) 检查外部链接图片
    const unreadItems = [];
    const relsBuf = zipEntries.get('word/_rels/document.xml.rels');
    if (relsBuf) {
      const rXml = relsBuf.toString('utf8');
      const relRe = /<Relationship\b([^>]+)\/?>/g;
      let rm;
      while ((rm = relRe.exec(rXml)) !== null) {
        const attrs = rm[1];
        const target = /Target="([^"]+)"/.exec(attrs)?.[1] || '';
        const type = /Type="([^"]+)"/.exec(attrs)?.[1] || '';
        const mode = /TargetMode="([^"]+)"/.exec(attrs)?.[1] || '';
        if (mode === 'External' && type.includes('image')) {
          unreadItems.push(`外部链接图片未离线内嵌：${target}`);
        }
      }
    }

    // 3) 解析正文段落与表格
    const docXml = docBuf.toString('utf8');
    const bodyMatch = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(docXml);
    const bodyXml = bodyMatch ? bodyMatch[1] : docXml;

    const headings = [];
    const heuristicHeadings = [];
    const paragraphs = [];
    const tables = [];

    for (const node of iterTopLevelBodyNodes(bodyXml)) {
      if (node.type === 'p') {
        const oleRe = /<[^:>]+:OLEObject\b[^>]*>/g;
        let om;
        while ((om = oleRe.exec(node.xml)) !== null) {
          const prog = /ProgID="([^"]+)"/.exec(om[0])?.[1] || '未知嵌入对象';
          unreadItems.push(`文档内含 OLE 嵌入附件（${prog}），需单独提供原件`);
        }

        const text = extractParagraphText(node.xml);
        if (!text) continue;

        const sid = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(node.xml)?.[1] || '';
        const stInfo = styleMap.get(sid) || { name: sid || 'Normal', outlineLvl: null };
        let level = stInfo.outlineLvl;
        if (level == null) {
          const hm = /heading\s*([1-6])|标题\s*([1-6])/i.exec(stInfo.name);
          if (hm) level = Number(hm[1] || hm[2]);
        }

        const entry = { text, style: stInfo.name || 'Normal' };
        if (level != null) {
          entry.level = level;
          headings.push({ level, title: text });
        } else if (
          HEADING_RE.test(text) &&
          text.length <= 30 &&
          !/[。；，.;]$/.test(text)
        ) {
          const hLvl = /^[0-9]+\.[0-9]+/.test(text) ? 2 : 1;
          heuristicHeadings.push({ level: hLvl, title: text });
        }
        paragraphs.push(entry);
      } else if (node.type === 'tbl') {
        const rows = [];
        const trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
        let trm;
        while ((trm = trRe.exec(node.xml)) !== null) {
          const cells = [];
          const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
          let tcm;
          while ((tcm = tcRe.exec(trm[1])) !== null) {
            const cellTexts = [];
            const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
            let pm;
            while ((pm = pRe.exec(tcm[1])) !== null) {
              const t = extractParagraphText(pm[0]);
              if (t) cellTexts.push(t);
            }
            cells.push(cellTexts.join('\n'));
          }
          if (cells.some(Boolean)) rows.push(cells);
        }
        if (rows.length) tables.push(rows);
      }
    }

    const finalHeadings = headings.length ? headings : heuristicHeadings;

    // 4) 解析批注 word/comments.xml
    const comments = [];
    const commentsBuf = zipEntries.get('word/comments.xml');
    if (commentsBuf) {
      const cXml = commentsBuf.toString('utf8');
      const cmRe = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;
      let cm;
      while ((cm = cmRe.exec(cXml)) !== null) {
        const attrs = cm[1];
        const author = xmlUnescape(/w:author="([^"]+)"/.exec(attrs)?.[1] || '评审人');
        const date = /w:date="([^"]+)"/.exec(attrs)?.[1] || '';
        const text = extractParagraphText(cm[2]);
        if (text) comments.push({ author, date, text });
      }
    }

    // 5) 提取内嵌媒体截图 word/media/*
    const media = [];
    const mediaNames = [...zipEntries.keys()]
      .filter((k) => k.startsWith('word/media/') && !k.endsWith('/'))
      .sort();
    const outMediaDir = extractDir ? path.resolve(extractDir) : null;
    if (outMediaDir && mediaNames.length) {
      fs.mkdirSync(outMediaDir, { recursive: true });
    }
    for (const mname of mediaNames) {
      const raw = zipEntries.get(mname);
      const { width, height, mime } = probeImageSize(raw);
      const filename = path.basename(mname);
      const item = { archive_path: mname, filename, mime, width, height };
      if (outMediaDir) {
        const savedPath = path.join(outMediaDir, filename);
        fs.writeFileSync(savedPath, raw);
        item.saved_path = savedPath;
      }
      media.push(item);
    }

    return {
      source_file: absDoc,
      template_outline: finalHeadings.map((h) => h.title),
      headings: finalHeadings,
      paragraph_count: paragraphs.length,
      paragraphs,
      table_count: tables.length,
      tables,
      comments,
      media,
      unread_items: unreadItems,
    };
  } finally {
    if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
  }
}

/* ============================================================================
 * 3. 五选项迭代状态机检查
 * ========================================================================== */

export function computeMenuState(prd) {
  const goalObj = prd?.goal || {};
  const hasGoal = typeof goalObj === 'string'
    ? Boolean(goalObj.trim())
    : Boolean(String(goalObj.summary || '').trim() || (Array.isArray(goalObj.objectives) && goalObj.objectives.length > 0));

  const materials = prd?.materials || [];
  const images = prd?.images || [];
  const feedback = prd?.feedback || [];
  const flow = prd?.flow || [];
  const screens = prd?.screens || [];
  const acceptance = prd?.acceptance || [];
  const openQuestions = prd?.open_questions || [];
  const templateInfo = typeof prd?.template === 'string'
    ? { name: prd.template }
    : (prd?.template || {});

  const options = [
    {
      id: 1,
      label: '设定、修改或补充需求目标',
      enabled: true,
      status: hasGoal ? '已设定，可继续调整' : '待设定（建议优先明确）',
    },
    {
      id: 2,
      label: '补充其他背景资料（需求文档、现状截图、外部反馈、内部评审意见等）',
      enabled: true,
      status: `已收录 ${materials.length} 份资料、${images.length} 张现状图、${feedback.length} 条反馈/评审`,
    },
    {
      id: 3,
      label: '基于已提供材料进行线上搜索和思考，辅助设计需求细节',
      enabled: hasGoal,
      reason_if_disabled: hasGoal ? null : '需先设定需求目标（选项 1 或 5）后方可启用',
      status: hasGoal ? '可用：可检索行业范式并补全异常/空态/防呆细节' : '未解锁：请先明确需求目标',
    },
    {
      id: 4,
      label: '提供其他 PRD 范本（对齐章节结构与颗粒度）',
      enabled: true,
      status: templateInfo.name ? `已采用范本：${templateInfo.name}` : '未指定（默认使用标准清晰 PRD 模板）',
    },
    {
      id: 5,
      label: '手动输入或修改具体需求内容',
      enabled: true,
      status: `当前含 ${flow.length} 步主流程、${screens.length} 张原型屏、${acceptance.length} 条验收标准`,
    },
    {
      id: 6,
      label: '预览摘要并生成双端 PRD（Figma 单页看板 + Word 文档）',
      enabled: true,
      status: (hasGoal && flow.length > 0 && screens.length > 0) ? '已具备出稿条件' : '可先出草稿（会标明待补项）',
    },
    {
      id: 0,
      label: '退出当前 PRD 模式（保存草稿进度，返回主菜单切换「生成原型图」或其他角色模式）',
      enabled: true,
      status: '随时可切换模式',
    },
  ];

  return {
    mode: 'prd',
    title: prd?.title || '未命名需求 PRD',
    status: prd?.status || '草稿',
    has_goal: hasGoal,
    ready_for_export: hasGoal && flow.length > 0 && screens.length > 0,
    open_questions_count: openQuestions.length,
    options,
    post_export_options: [
      { id: 1, label: '继续修改或补充当前 PRD' },
      { id: 2, label: '紧接着基于这份 PRD 生成可操作预览原型图（进入原型图模式）' },
      { id: 0, label: '退出当前模式，返回主菜单切换其他角色或任务' },
    ],
  };
}

/* ============================================================================
 * 4. 数据归一化
 * ========================================================================== */

export function normalizePrd(raw, baseDir) {
  const goalRaw = raw.goal || {};
  const goal = typeof goalRaw === 'string'
    ? {
        background: raw.background || '',
        target_users: raw.target_users || '待明确目标用户',
        summary: goalRaw,
        objectives: [goalRaw],
        non_goals: [...(raw.non_goals || [])],
      }
    : {
        background: goalRaw.background || raw.background || '',
        target_users: goalRaw.target_users || raw.target_users || '业务目标用户',
        summary: goalRaw.summary || raw.summary || (goalRaw.objectives?.[0] || ''),
        objectives: [...(goalRaw.objectives || [])],
        non_goals: [...(goalRaw.non_goals || raw.non_goals || [])],
      };

  const images = (raw.images || []).map((img, i) => {
    const relPath = img.path || img.src || '';
    const absPath = relPath ? path.resolve(baseDir, relPath) : null;
    const exists = Boolean(absPath && fs.existsSync(absPath) && fs.statSync(absPath).isFile());
    const bytes = exists ? fs.readFileSync(absPath) : null;
    const dims = bytes ? probeImageSize(bytes) : { width: 800, height: 500, mime: 'image/png' };
    return {
      id: img.id || `IMG-${String(i + 1).padStart(2, '0')}`,
      title: img.title || img.label || `现状画面 ${i + 1}`,
      source: img.source || (relPath || '现状截图待补充'),
      state: img.state || '现状基准',
      note: img.note || img.caption || '',
      rel_path: relPath,
      bytes,
      mime: dims.mime,
      width: dims.width,
      height: dims.height,
      missing: !exists,
    };
  });

  const feedback = (raw.feedback || []).map((fb) => ({
    category: fb.category || fb.type || '外部反馈',
    source: fb.source || '未注明来源',
    content: fb.content || fb.quote || '',
    decision: fb.decision || fb.status || '待确认',
    impact: fb.impact || '',
  }));

  const flow = (raw.flow || []).map((st, i) => (
    typeof st === 'string'
      ? { step: String(i + 1).padStart(2, '0'), role: '用户', title: st, action: st, result: '进入下一步' }
      : {
          step: String(st.step || String(i + 1).padStart(2, '0')),
          role: st.role || '用户',
          title: st.title || st.name || `步骤 ${i + 1}`,
          action: st.action || '',
          result: st.result || st.expected || '',
        }
  ));

  const branches = (raw.branches || []).map((br) => ({
    name: br.name || '分支场景',
    when: br.when || br.trigger || '',
    action: br.action || '',
    result: br.result || '',
  }));

  const screens = (raw.screens || []).map((sc, i) => {
    const blocks = (sc.elements || sc.blocks || []).map((b) => (
      typeof b === 'string'
        ? { kind: 'card', label: b, detail: '', emphasis: false, items: [] }
        : {
            kind: String(b.kind || b.type || 'card').toLowerCase(),
            label: b.label || b.title || b.text || '',
            detail: b.detail || b.value || b.subtext || '',
            emphasis: Boolean(b.emphasis ?? b.primary),
            items: [...(b.items || [])],
          }
    ));
    return {
      id: sc.id || `screen-${String(i + 1).padStart(2, '0')}`,
      name: sc.name || sc.title || `原型屏 ${String(i + 1).padStart(2, '0')}`,
      surface: String(sc.surface || raw.surface || 'mobile').toLowerCase(),
      state: sc.state || '默认状态',
      entry: sc.entry || '从上一屏进入',
      action: sc.action || '执行本屏主操作',
      result: sc.result || '更新状态并反馈',
      nav_right: sc.nav_right || '',
      blocks,
    };
  });

  const sections = (raw.sections || []).map((sec) => ({
    heading: sec.heading || sec.title || '需求细则',
    summary: sec.summary || sec.body || '',
    origin: sec.origin || '',
    items: (sec.items || sec.bullets || []).map((it) => (
      typeof it === 'string'
        ? { text: it, origin: '' }
        : { text: it.text || '', origin: it.origin || it.source || '' }
    )),
  }));

  const acceptance = (raw.acceptance || []).map((ac, i) => (
    typeof ac === 'string'
      ? { id: `AC-${String(i + 1).padStart(2, '0')}`, precondition: '默认前置状态', action: '执行目标操作', expected: ac }
      : {
          id: ac.id || `AC-${String(i + 1).padStart(2, '0')}`,
          precondition: ac.precondition || ac.given || '',
          action: ac.action || ac.when || '',
          expected: ac.expected || ac.then || '',
        }
  ));

  const materials = (raw.materials || []).map((m) => (
    typeof m === 'string'
      ? { name: m, kind: '参考资料', note: '' }
      : { name: m.name || '未命名资料', kind: m.kind || m.type || '参考资料', note: m.note || m.status || '' }
  ));

  const tplRaw = raw.template || {};
  const template = typeof tplRaw === 'string'
    ? { name: tplRaw, notes: '' }
    : { name: tplRaw.name || '标准业务设计 PRD 模板', notes: tplRaw.notes || '' };

  return {
    title: raw.title || '未命名产品需求文档（PRD）',
    subtitle: raw.subtitle || goal.summary || '',
    status: raw.status || '草稿',
    version: raw.version || 'v0.1',
    updated_at: raw.updated_at || '待补充日期',
    workspace: raw.workspace || '',
    owner_role: raw.owner_role || '业务设计人员',
    surface: String(raw.surface || 'mobile').toLowerCase(),
    template,
    goal,
    images,
    feedback,
    flow,
    branches,
    screens,
    sections,
    acceptance,
    open_questions: [...(raw.open_questions || [])],
    materials,
  };
}

/* ============================================================================
 * 5. 生成美观易读的 Figma 单页 PRD 看板规格（PRD.figma.json）
 * ========================================================================== */

const P = {
  canvas: '#F3F5F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  heroBg: '#142033',
  heroSub: '#CBD5E1',
  ink: '#0F172A',
  inkSec: '#334155',
  inkMuted: '#64748B',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  accent: '#1D4ED8',
  accentSoft: '#EFF6FF',
  teal: '#0F766E',
  tealSoft: '#F0FDFA',
  amber: '#B45309',
  amberSoft: '#FFFBEB',
  coral: '#BE123C',
  coralSoft: '#FFF1F2',
  wireBg: '#FCFCFD',
  wireChrome: '#F1F5F9',
  wireCta: '#1E293B',
};

function txt(text, { size = 14, weight = 400, color = P.ink, w = 'fill', lineHeight = null, align = 'LEFT', name = null } = {}) {
  const n = { type: 'TEXT', text: String(text), size, weight, color, align };
  if (name) n.name = name;
  if (w !== null) n.w = w;
  if (lineHeight !== null) n.lineHeight = lineHeight;
  return n;
}

function pill(label, bg, fg, { size = 12, pad = [4, 10] } = {}) {
  return {
    type: 'FRAME',
    name: `Tag · ${String(label).slice(0, 14)}`,
    layout: 'H',
    w: 'hug',
    h: 'hug',
    pad,
    radius: 6,
    fill: bg,
    cross: 'CENTER',
    children: [txt(label, { size, weight: 600, color: fg, w: null })],
  };
}

function sectionHeader(num, title, subtitle) {
  return {
    type: 'FRAME',
    name: `标题 · ${num} ${title}`,
    layout: 'H',
    w: 'fill',
    h: 'hug',
    gap: 14,
    cross: 'CENTER',
    fill: null,
    clip: false,
    children: [
      pill(num, P.accent, '#FFFFFF', { size: 13, pad: [6, 12] }),
      {
        type: 'FRAME',
        name: '标题组',
        layout: 'V',
        w: 'fill',
        h: 'hug',
        gap: 2,
        fill: null,
        children: [
          txt(title, { size: 22, weight: 700, color: P.ink }),
          txt(subtitle, { size: 13, color: P.inkMuted }),
        ],
      },
    ],
  };
}

function decisionColors(decision) {
  const d = String(decision || '').trim();
  if (/已决定|已采纳|已确认|通过/.test(d)) return [P.tealSoft, P.teal];
  if (/Agent|建议|待确认|待拍板|有人提议/.test(d)) return [P.amberSoft, P.amber];
  if (/不纳入|暂缓|拒绝|冲突/.test(d)) return [P.coralSoft, P.coral];
  return [P.accentSoft, P.accent];
}

function buildWireframeBlock(b) {
  const { kind, label, detail, items } = b;
  if (['hero', 'article', 'content'].includes(kind)) {
    return {
      type: 'FRAME',
      name: `内容块 · ${label.slice(0, 12)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: 14,
      gap: 8,
      radius: 8,
      fill: '#FFFFFF',
      stroke: P.border,
      children: [
        txt(label, { size: 16, weight: 700, color: P.ink, lineHeight: 22 }),
        ...(detail ? [txt(detail, { size: 13, color: P.inkSec, lineHeight: 20 })] : []),
      ],
    };
  }
  if (['tabs', 'segmented'].includes(kind)) {
    const tabLabels = items.length ? items : String(detail || label).split(/[/|、,，]/).map((s) => s.trim()).filter(Boolean);
    return {
      type: 'FRAME',
      name: `分段栏 · ${label.slice(0, 10)}`,
      layout: 'H',
      w: 'fill',
      h: 'hug',
      pad: 4,
      gap: 6,
      radius: 8,
      fill: P.wireChrome,
      children: tabLabels.slice(0, 4).map((tl, idx) => ({
        type: 'FRAME',
        name: `Tab · ${tl}`,
        layout: 'H',
        w: 'fill',
        h: 'hug',
        pad: [6, 8],
        radius: 6,
        main: 'CENTER',
        cross: 'CENTER',
        fill: idx === 0 ? P.wireCta : P.wireChrome,
        children: [txt(tl, { size: 12, weight: idx === 0 ? 600 : 400, color: idx === 0 ? '#FFFFFF' : P.inkSec, w: null })],
      })),
    };
  }
  if (['input', 'search'].includes(kind)) {
    return {
      type: 'FRAME',
      name: `输入框 · ${label.slice(0, 10)}`,
      layout: 'H',
      w: 'fill',
      h: 'hug',
      pad: [10, 12],
      radius: 8,
      fill: '#FFFFFF',
      stroke: P.borderStrong,
      main: 'SPACE_BETWEEN',
      cross: 'CENTER',
      children: [
        txt(label || '请输入内容', { size: 13, color: P.inkMuted, w: null }),
        txt(detail || '输入', { size: 11, color: P.inkMuted, w: null }),
      ],
    };
  }
  if (kind === 'empty') {
    return {
      type: 'FRAME',
      name: `空状态 · ${label.slice(0, 10)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: [28, 16],
      gap: 6,
      radius: 8,
      fill: P.surfaceAlt,
      stroke: P.borderStrong,
      dash: [4, 4],
      cross: 'CENTER',
      children: [
        txt('[ 空状态示意 ]', { size: 11, weight: 600, color: P.inkMuted, w: null, align: 'CENTER' }),
        txt(label, { size: 14, weight: 600, color: P.inkSec, align: 'CENTER' }),
        ...(detail ? [txt(detail, { size: 12, color: P.inkMuted, align: 'CENTER' })] : []),
      ],
    };
  }
  if (['button', 'cta', 'actions'].includes(kind)) {
    const primary = b.emphasis !== false;
    return {
      type: 'FRAME',
      name: `按钮 · ${label.slice(0, 12)}`,
      layout: 'H',
      w: 'fill',
      h: 'hug',
      pad: [11, 14],
      radius: 8,
      main: 'CENTER',
      cross: 'CENTER',
      fill: primary ? P.wireCta : '#FFFFFF',
      stroke: primary ? P.wireCta : P.borderStrong,
      children: [txt(label + (detail ? `（${detail}）` : ''), { size: 12, weight: 600, color: primary ? '#FFFFFF' : P.ink, w: 'fill', align: 'CENTER', lineHeight: 18 })],
    };
  }
  if (['banner', 'toast', 'notice'].includes(kind)) {
    return {
      type: 'FRAME',
      name: `提示条 · ${label.slice(0, 10)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: [8, 12],
      gap: 2,
      radius: 6,
      fill: P.amberSoft,
      stroke: '#FDE68A',
      children: [
        txt(label, { size: 12, weight: 600, color: P.amber }),
        ...(detail ? [txt(detail, { size: 11, color: P.inkSec })] : []),
      ],
    };
  }
  if (kind === 'list' && items.length) {
    return {
      type: 'FRAME',
      name: `列表组 · ${label.slice(0, 10)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      gap: 6,
      fill: null,
      children: [
        ...(label ? [txt(label, { size: 12, weight: 600, color: P.inkMuted })] : []),
        ...items.map((item, idx) => ({
          type: 'FRAME',
          name: `列表项 ${idx + 1}`,
          layout: 'H',
          w: 'fill',
          h: 'hug',
          pad: [10, 12],
          radius: 6,
          fill: '#FFFFFF',
          stroke: P.border,
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          children: [
            txt(String(item), { size: 13, weight: 500, color: P.ink, w: null }),
            txt('›', { size: 14, weight: 600, color: P.inkMuted, w: null }),
          ],
        })),
      ],
    };
  }
  return {
    type: 'FRAME',
    name: `线框项 · ${label.slice(0, 12)}`,
    layout: 'V',
    w: 'fill',
    h: 'hug',
    pad: 12,
    gap: 4,
    radius: 8,
    fill: '#FFFFFF',
    stroke: P.border,
    children: [
      txt(label, { size: 13, weight: 600, color: P.ink }),
      ...(detail ? [txt(detail, { size: 12, color: P.inkMuted, lineHeight: 18 })] : []),
    ],
  };
}

function buildWireframeScreen(sc, idx) {
  const screenW = sc.surface === 'desktop' ? 520 : 356;
  const bodyBlocks = sc.blocks.length
    ? sc.blocks.map(buildWireframeBlock)
    : [buildWireframeBlock({ kind: 'empty', label: '待补充本屏原型元素', detail: '', items: [] })];

  return {
    type: 'FRAME',
    name: `原型卡 ${String(idx).padStart(2, '0')} · ${sc.name}`,
    layout: 'V',
    w: screenW,
    h: 'hug',
    pad: 16,
    gap: 12,
    radius: 16,
    fill: '#FFFFFF',
    stroke: P.border,
    clip: false,
    children: [
      {
        type: 'FRAME',
        name: '屏幕编号头',
        layout: 'H',
        w: 'fill',
        h: 'hug',
        main: 'SPACE_BETWEEN',
        cross: 'CENTER',
        fill: null,
        children: [
          pill(`Screen ${String(idx).padStart(2, '0')}`, P.accentSoft, P.accent, { size: 11 }),
          pill(sc.state, P.tealSoft, P.teal, { size: 11 }),
        ],
      },
      {
        type: 'FRAME',
        name: `原型屏画布 · ${sc.name}`,
        layout: 'V',
        w: 'fill',
        h: 'hug',
        radius: 14,
        fill: P.wireBg,
        stroke: '#94A3B8',
        strokeWeight: 1.5,
        children: [
          {
            type: 'FRAME',
            name: '顶栏导航',
            layout: 'H',
            w: 'fill',
            h: 'hug',
            pad: [10, 14],
            fill: P.wireChrome,
            main: 'SPACE_BETWEEN',
            cross: 'CENTER',
            children: [
              txt(sc.name, { size: 13, weight: 700, color: P.ink, w: null }),
              pill(sc.nav_right || sc.state, '#FFFFFF', P.inkSec, { size: 11, pad: [3, 8] }),
            ],
          },
          {
            type: 'FRAME',
            name: '屏幕主体',
            layout: 'V',
            w: 'fill',
            h: 'hug',
            pad: 16,
            gap: 10,
            fill: P.wireBg,
            children: bodyBlocks,
          },
        ],
      },
      {
        type: 'FRAME',
        name: `交互说明 · ${sc.name}`,
        layout: 'V',
        w: 'fill',
        h: 'hug',
        pad: 12,
        gap: 6,
        radius: 10,
        fill: P.surfaceAlt,
        stroke: P.border,
        children: [
          txt(`入口：${sc.entry}`, { size: 12, color: P.inkSec, lineHeight: 18 }),
          txt(`动作：${sc.action}`, { size: 12, weight: 600, color: P.ink, lineHeight: 18 }),
          txt(`结果：${sc.result}`, { size: 12, color: P.teal, lineHeight: 18 }),
        ],
      },
    ],
  };
}

export function buildFigmaSpec(prd) {
  const { goal } = prd;

  const heroCard = {
    type: 'FRAME',
    name: '00 PRD 文档头卡',
    layout: 'V',
    w: 'fill',
    h: 'hug',
    pad: [36, 40],
    gap: 16,
    radius: 20,
    fill: P.heroBg,
    children: [
      {
        type: 'FRAME',
        name: '元信息标签栏',
        layout: 'H',
        wrap: true,
        w: 'fill',
        h: 'hug',
        gap: 10,
        fill: null,
        children: [
          pill(`状态：${prd.status}`, prd.status.includes('草稿') ? '#F59E0B' : '#10B981', '#0F172A', { size: 12, pad: [5, 12] }),
          pill(`版本：${prd.version}`, '#1E293B', '#E2E8F0', { size: 12, pad: [5, 12] }),
          pill(`角色：${prd.owner_role}`, '#1E293B', '#E2E8F0', { size: 12, pad: [5, 12] }),
          pill(`范本：${prd.template.name}`, '#1E293B', '#E2E8F0', { size: 12, pad: [5, 12] }),
          pill(`更新：${prd.updated_at}`, '#1E293B', '#E2E8F0', { size: 12, pad: [5, 12] }),
        ],
      },
      txt(prd.title, { size: 34, weight: 700, color: '#FFFFFF', lineHeight: 44 }),
      txt(prd.subtitle || goal.summary || '待补充一句话核心需求目标', { size: 16, color: P.heroSub, lineHeight: 26 }),
    ],
  };

  const secGoals = {
    type: 'FRAME',
    name: '01 需求目标与范围',
    layout: 'V',
    w: 'fill',
    h: 'hug',
    gap: 20,
    fill: null,
    clip: false,
    children: [
      sectionHeader('01', '需求目标与边界范围', `目标对象：${goal.target_users}`),
      {
        type: 'FRAME',
        name: '目标双栏容器',
        layout: 'H',
        w: 'fill',
        h: 'hug',
        gap: 24,
        fill: null,
        clip: false,
        children: [
          {
            type: 'FRAME',
            name: '背景与核心目标卡',
            layout: 'V',
            w: 'fill',
            h: 'hug',
            pad: 24,
            gap: 12,
            radius: 16,
            fill: '#FFFFFF',
            stroke: P.border,
            children: [
              pill('背景痛点与核心目标', P.accentSoft, P.accent),
              ...(goal.background ? [txt(goal.background, { size: 14, color: P.inkSec, lineHeight: 22 })] : []),
              ...(goal.objectives.length ? goal.objectives : ['待设定具体需求目标'])
                .map((obj) => txt(`• ${obj}`, { size: 14, weight: 500, color: P.ink, lineHeight: 22 })),
            ],
          },
          {
            type: 'FRAME',
            name: '明确不做与模板约定卡',
            layout: 'V',
            w: 'fill',
            h: 'hug',
            pad: 24,
            gap: 12,
            radius: 16,
            fill: '#FFFFFF',
            stroke: P.border,
            children: [
              pill('本次不做（Non-Goals）与边界', P.coralSoft, P.coral),
              ...(goal.non_goals.length ? goal.non_goals : ['暂无显式排除项（待业务确认边界）'])
                .map((ng) => txt(`✕ ${ng}`, { size: 14, color: P.inkSec, lineHeight: 22 })),
              ...(prd.template.notes ? [txt(`范本约定：${prd.template.notes}`, { size: 12, color: P.inkMuted, lineHeight: 18 })] : []),
            ],
          },
        ],
      },
    ],
  };

  const imgCards = prd.images.length
    ? prd.images.map((img) => {
        const cardW = 340;
        const previewW = cardW - 28;
        let previewBox;
        if (!img.missing && img.bytes) {
          const dataUri = `data:${img.mime};base64,${img.bytes.toString('base64')}`;
          const previewH = Math.max(140, Math.min(320, Math.round(previewW * (img.height / Math.max(1, img.width)))));
          previewBox = {
            type: 'RECT',
            name: `现状图 · ${img.title}`,
            w: previewW,
            h: previewH,
            radius: 8,
            fill: { image: dataUri, scaleMode: 'FIT' },
            stroke: P.border,
          };
        } else {
          previewBox = {
            type: 'FRAME',
            name: `待补现状图 · ${img.title}`,
            layout: 'V',
            w: 'fill',
            h: 160,
            pad: 16,
            main: 'CENTER',
            cross: 'CENTER',
            gap: 6,
            radius: 8,
            fill: P.surfaceAlt,
            stroke: P.borderStrong,
            dash: [4, 4],
            children: [
              txt('现状截图待补充', { size: 13, weight: 600, color: P.inkMuted, w: null }),
              txt(`预期来源：${img.source}`, { size: 11, color: P.inkMuted, align: 'CENTER' }),
            ],
          };
        }
        return {
          type: 'FRAME',
          name: `现状卡 · ${img.title}`,
          layout: 'V',
          w: cardW,
          h: 'hug',
          pad: 14,
          gap: 10,
          radius: 14,
          fill: '#FFFFFF',
          stroke: P.border,
          children: [
            {
              type: 'FRAME',
              name: '现状卡头',
              layout: 'H',
              w: 'fill',
              h: 'hug',
              main: 'SPACE_BETWEEN',
              cross: 'CENTER',
              fill: null,
              children: [
                txt(img.title, { size: 14, weight: 700, color: P.ink, w: null }),
                pill(img.state, P.surfaceAlt, P.inkSec, { size: 11 }),
              ],
            },
            previewBox,
            txt(`来源：${img.source}`, { size: 11, color: P.inkMuted }),
            ...(img.note ? [txt(img.note, { size: 12, color: P.inkSec, lineHeight: 18 })] : []),
          ],
        };
      })
    : [
        {
          type: 'FRAME',
          name: '现状截图待补充占位',
          layout: 'V',
          w: 'fill',
          h: 'hug',
          pad: 20,
          gap: 6,
          radius: 14,
          fill: '#FFFFFF',
          stroke: P.borderStrong,
          dash: [5, 5],
          children: [
            txt('尚未提供现状页面截图（待补充）', { size: 14, weight: 600, color: P.inkSec }),
            txt('说明：不以新绘制的原型图冒充旧版现状；后续可通过选项 2 补充截图。', { size: 12, color: P.inkMuted }),
          ],
        },
      ];

  const fbRows = prd.feedback.map((fb) => {
    const [bg, fg] = decisionColors(fb.decision);
    return {
      type: 'FRAME',
      name: `输入记录 · ${fb.source.slice(0, 14)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: 16,
      gap: 8,
      radius: 12,
      fill: '#FFFFFF',
      stroke: P.border,
      children: [
        {
          type: 'FRAME',
          name: '反馈来源行',
          layout: 'H',
          w: 'fill',
          h: 'hug',
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          fill: null,
          children: [
            txt(`[${fb.category}] ${fb.source}`, { size: 13, weight: 700, color: P.ink, w: null }),
            pill(fb.decision, bg, fg, { size: 11 }),
          ],
        },
        txt(fb.content, { size: 13, color: P.inkSec, lineHeight: 20 }),
        ...(fb.impact ? [txt(`方案影响：${fb.impact}`, { size: 12, color: P.inkMuted })] : []),
      ],
    };
  });

  const secMaterials = {
    type: 'FRAME',
    name: '02 现状材料与输入溯源',
    layout: 'V',
    w: 'fill',
    h: 'hug',
    gap: 20,
    fill: null,
    clip: false,
    children: [
      sectionHeader('02', '现状截图与多源输入溯源', '严格区分现状事实、外部反馈、内部评审与 Agent 检索推演'),
      {
        type: 'FRAME',
        name: '现状截图画廊',
        layout: 'H',
        wrap: true,
        w: 'fill',
        h: 'hug',
        gap: 20,
        fill: null,
        clip: false,
        children: imgCards,
      },
      ...(fbRows.length
        ? [{ type: 'FRAME', name: '多源反馈与评审列表', layout: 'V', w: 'fill', h: 'hug', gap: 12, fill: null, children: fbRows }]
        : []),
    ],
  };

  const flowNodes = [];
  prd.flow.forEach((st, idx) => {
    if (idx > 0) {
      flowNodes.push({
        type: 'FRAME',
        name: `流转箭头 ${idx}`,
        layout: 'H',
        w: 'hug',
        h: 'hug',
        pad: [8, 6],
        cross: 'CENTER',
        fill: null,
        children: [txt('→', { size: 22, weight: 700, color: P.accent, w: null })],
      });
    }
    flowNodes.push({
      type: 'FRAME',
      name: `步骤 ${st.step} · ${st.title}`,
      layout: 'V',
      w: 280,
      h: 'hug',
      pad: 18,
      gap: 8,
      radius: 14,
      fill: '#FFFFFF',
      stroke: P.border,
      children: [
        {
          type: 'FRAME',
          name: '步骤头',
          layout: 'H',
          w: 'fill',
          h: 'hug',
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          fill: null,
          children: [
            pill(`STEP ${st.step}`, P.accent, '#FFFFFF', { size: 11 }),
            pill(st.role, P.surfaceAlt, P.inkSec, { size: 11 }),
          ],
        },
        txt(st.title, { size: 16, weight: 700, color: P.ink }),
        txt(`操作：${st.action}`, { size: 13, color: P.inkSec, lineHeight: 19 }),
        txt(`结果：${st.result}`, { size: 13, weight: 500, color: P.teal, lineHeight: 19 }),
      ],
    });
  });

  const branchCards = prd.branches.map((br) => ({
    type: 'FRAME',
    name: `分支 · ${br.name}`,
    layout: 'H',
    w: 'fill',
    h: 'hug',
    pad: [12, 16],
    gap: 12,
    radius: 10,
    fill: P.amberSoft,
    stroke: '#FDE68A',
    cross: 'CENTER',
    children: [
      pill(`分支 · ${br.name}`, '#FDE68A', P.amber, { size: 11 }),
      txt(`当「${br.when}」时：${br.action} → ${br.result}`, { size: 13, color: P.ink }),
    ],
  }));

  const secFlow = {
    type: 'FRAME',
    name: '03 业务流程展示',
    layout: 'V',
    w: 'fill',
    h: 'hug',
    gap: 18,
    fill: null,
    clip: false,
    children: [
      sectionHeader('03', '业务流程展示', '最短主路径与关键分支/异常闭环'),
      {
        type: 'FRAME',
        name: '主流程横向链路',
        layout: 'H',
        wrap: true,
        w: 'fill',
        h: 'hug',
        gap: 12,
        cross: 'CENTER',
        fill: null,
        clip: false,
        children: flowNodes.length ? flowNodes : [txt('待补充流程步骤', { size: 14, color: P.inkMuted })],
      },
      ...(branchCards.length
        ? [{ type: 'FRAME', name: '关键分支与异常流', layout: 'V', w: 'fill', h: 'hug', gap: 10, fill: null, children: branchCards }]
        : []),
    ],
  };

  const secWireframes = {
    type: 'FRAME',
    name: '04 产品原型图',
    layout: 'V',
    w: 'fill',
    h: 'hug',
    gap: 20,
    fill: null,
    clip: false,
    children: [
      sectionHeader('04', '产品原型图（关键状态线框）', '每屏标明前置入口、核心操作与状态流转结果，评审无需口头指路'),
      {
        type: 'FRAME',
        name: '原型屏展示台',
        layout: 'H',
        wrap: true,
        w: 'fill',
        h: 'hug',
        pad: 24,
        gap: 24,
        radius: 20,
        fill: '#E8EEF6',
        clip: false,
        children: prd.screens.length
          ? prd.screens.map((sc, idx) => buildWireframeScreen(sc, idx + 1))
          : [txt('待补充原型屏幕', { size: 14, color: P.inkMuted })],
      },
    ],
  };

  const detailCards = prd.sections.map((sec) => ({
    type: 'FRAME',
    name: `细则 · ${sec.heading.slice(0, 16)}`,
    layout: 'V',
    w: 'fill',
    h: 'hug',
    pad: 20,
    gap: 10,
    radius: 14,
    fill: '#FFFFFF',
    stroke: P.border,
    children: [
      {
        type: 'FRAME',
        name: '细则标题栏',
        layout: 'H',
        w: 'fill',
        h: 'hug',
        main: 'SPACE_BETWEEN',
        cross: 'CENTER',
        fill: null,
        children: [
          txt(sec.heading, { size: 16, weight: 700, color: P.ink, w: null }),
          ...(sec.origin ? [pill(sec.origin, P.amberSoft, P.amber, { size: 11 })] : []),
        ],
      },
      ...(sec.summary ? [txt(sec.summary, { size: 13, color: P.inkSec, lineHeight: 20 })] : []),
      ...sec.items.map((it) => txt(`• ${it.origin ? `[${it.origin}] ` : ''}${it.text}`, { size: 13, color: P.inkSec, lineHeight: 20 })),
    ],
  }));

  const acRows = prd.acceptance.map((ac) => ({
    type: 'FRAME',
    name: `验收项 · ${ac.id}`,
    layout: 'H',
    w: 'fill',
    h: 'hug',
    pad: [12, 16],
    gap: 16,
    radius: 10,
    fill: P.surfaceAlt,
    stroke: P.border,
    cross: 'CENTER',
    children: [
      pill(ac.id, P.tealSoft, P.teal, { size: 11 }),
      txt(`前置：${ac.precondition}`, { size: 13, color: P.inkSec }),
      txt(`操作：${ac.action}`, { size: 13, weight: 600, color: P.ink }),
      txt(`预期：${ac.expected}`, { size: 13, weight: 600, color: P.teal }),
    ],
  }));

  const openQCard = prd.open_questions.length
    ? {
        type: 'FRAME',
        name: '待确认问题卡',
        layout: 'V',
        w: 'fill',
        h: 'hug',
        pad: 20,
        gap: 8,
        radius: 14,
        fill: P.amberSoft,
        stroke: '#FCD34D',
        children: [
          txt('待业务/评审确认项（Open Questions）', { size: 15, weight: 700, color: P.amber }),
          ...prd.open_questions.map((q) => txt(`? ${q}`, { size: 13, color: P.ink, lineHeight: 20 })),
        ],
      }
    : null;

  const secSpecs = {
    type: 'FRAME',
    name: '05 需求细化与验收标准',
    layout: 'V',
    w: 'fill',
    h: 'hug',
    gap: 18,
    fill: null,
    clip: false,
    children: [
      sectionHeader('05', '需求细化与验收标准', '覆盖正常流、边界状态及可观测验收口径'),
      ...detailCards,
      {
        type: 'FRAME',
        name: '验收标准总卡',
        layout: 'V',
        w: 'fill',
        h: 'hug',
        pad: 22,
        gap: 12,
        radius: 16,
        fill: '#FFFFFF',
        stroke: P.border,
        children: [
          txt('可直接验证的验收标准', { size: 17, weight: 700, color: P.ink }),
          ...(acRows.length ? acRows : [txt('待补充可验证的验收条件', { size: 13, color: P.inkMuted })]),
        ],
      },
      ...(openQCard ? [openQCard] : []),
    ],
  };

  return {
    frames: [
      {
        type: 'FRAME',
        name: `PRD 单页看板 · ${prd.title}`,
        layout: 'V',
        w: 1640,
        h: 'hug',
        pad: 48,
        gap: 36,
        radius: 24,
        fill: P.canvas,
        clip: false,
        children: [heroCard, secGoals, secMaterials, secFlow, secWireframes, secSpecs],
      },
    ],
  };
}

/* ============================================================================
 * 6. 生成标准可编辑 Word 文档（PRD.docx，纯 Node OOXML + writeZip）
 * ========================================================================== */

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="PingFang SC" w:hAnsi="PingFang SC" w:eastAsia="PingFang SC" w:cs="Arial"/>
        <w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="1E293B"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:qFormat/>
    <w:pPr><w:spacing w:before="80" w:after="160"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="0F172A"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/>
      <w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="CBD5E1"/></w:pBdr>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="0F172A"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="1D4ED8"/></w:rPr>
  </w:style>
</w:styles>`;

function wP(text = '', { style = null, bold = false, color = null, sizeHalfPt = null, shading = null, leftBorder = null } = {}) {
  const ppr = [];
  if (style) ppr.push(`<w:pStyle w:val="${xmlEscape(style)}"/>`);
  if (leftBorder) ppr.push(`<w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="${xmlEscape(leftBorder)}"/></w:pBdr>`);
  if (shading) ppr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${xmlEscape(shading)}"/>`);

  const rpr = [];
  if (bold) rpr.push('<w:b/>');
  if (color) rpr.push(`<w:color w:val="${xmlEscape(color)}"/>`);
  if (sizeHalfPt) rpr.push(`<w:sz w:val="${sizeHalfPt}"/><w:szCs w:val="${sizeHalfPt}"/>`);
  const rprStr = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';

  const runs = String(text).split('\n').map((line, i) =>
    `${i > 0 ? '<w:r><w:br/></w:r>' : ''}<w:r>${rprStr}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`
  ).join('');
  return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs}</w:p>`;
}

function wTable(headers, rows, { headerFill = 'EEF2FF', borderColor = 'CBD5E1' } = {}) {
  const tblPr = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>` +
    `<w:top w:val="single" w:sz="6" w:space="0" w:color="${borderColor}"/>` +
    `<w:left w:val="single" w:sz="6" w:space="0" w:color="${borderColor}"/>` +
    `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="${borderColor}"/>` +
    `<w:right w:val="single" w:sz="6" w:space="0" w:color="${borderColor}"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="${borderColor}"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="${borderColor}"/>` +
    `</w:tblBorders><w:tblCellMar><w:top w:w="110" w:type="dxa"/><w:left w:w="150" w:type="dxa"/>` +
    `<w:bottom w:w="110" w:type="dxa"/><w:right w:w="150" w:type="dxa"/></w:tblCellMar></w:tblPr>`;

  const trs = [];
  if (headers?.length) {
    trs.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h) =>
      `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${headerFill}"/></w:tcPr>${wP(h, { bold: true, color: '0F172A', sizeHalfPt: 20 })}</w:tc>`
    ).join('')}</w:tr>`);
  }
  for (const row of rows) {
    trs.push(`<w:tr>${row.map((cell) => `<w:tc>${wP(cell, { sizeHalfPt: 20 })}</w:tc>`).join('')}</w:tr>`);
  }
  return `<w:tbl>${tblPr}${trs.join('')}</w:tbl>`;
}

function wWireframeBox(sc, idx) {
  const title = `【Screen ${String(idx).padStart(2, '0')} · ${sc.name}】  状态：${sc.state}${sc.nav_right ? `  |  顶栏右侧：${sc.nav_right}` : ''}`;
  const kindMap = {
    hero: '[主内容区]', article: '[正文区]', content: '[内容块]', tabs: '[分段切换]',
    input: '[输入框]', search: '[搜索框]', empty: '[空状态占位]', button: '[主操作按钮]',
    cta: '[主操作按钮]', actions: '[操作按钮组]', banner: '[状态提示条]', list: '[列表容器]',
  };
  const rows = sc.blocks.map((b) => {
    const tag = kindMap[b.kind] || '[界面元素]';
    const extra = b.detail ? ` — ${b.detail}` : (b.items.length ? ` — ${b.items.join(' / ')}` : '');
    return [`${tag}  ${b.label}${extra}`];
  });
  rows.push([`↳ 交互说明｜前置入口：${sc.entry}  →  本屏动作：${sc.action}  →  结果：${sc.result}`]);
  return wTable([title], rows, { headerFill: 'E2E8F0', borderColor: '64748B' });
}

function wInlineImage(relId, docPrId, name, widthPx, heightPx) {
  const maxCx = 5_200_000;
  let cx = widthPx * 9525;
  let cy = heightPx * 9525;
  if (cx > maxCx) {
    const scale = maxCx / cx;
    cx = maxCx;
    cy = Math.max(1, Math.round(cy * scale));
  }
  const escName = xmlEscape(name);
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="${escName}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${escName}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export function writeDocx(prd, outPath) {
  const body = [];
  const mediaEntries = [];
  const imgRels = [];

  body.push(wP(prd.title, { style: 'Title' }));
  if (prd.subtitle) body.push(wP(prd.subtitle, { color: '334155', sizeHalfPt: 23, shading: 'F8FAFC', leftBorder: '1D4ED8' }));

  body.push(wTable(['元信息项', '内容', '元信息项', '内容'], [
    ['文档状态', prd.status, '版本号', prd.version],
    ['负责角色', prd.owner_role, '更新日期', prd.updated_at],
    ['目标对象', prd.goal.target_users, '采用 PRD 范本', prd.template.name],
  ]));

  body.push(wP('一、需求背景与目标范围', { style: 'Heading1' }));
  if (prd.goal.background) {
    body.push(wP('1.1 背景与现状痛点', { style: 'Heading2' }));
    body.push(wP(prd.goal.background));
  }
  body.push(wP('1.2 核心需求目标', { style: 'Heading2' }));
  (prd.goal.objectives.length ? prd.goal.objectives : ['待补充具体需求目标'])
    .forEach((obj, i) => body.push(wP(`${i + 1}. ${obj}`, { bold: true })));

  body.push(wP('1.3 本次不做范围（Non-Goals）', { style: 'Heading2' }));
  (prd.goal.non_goals.length ? prd.goal.non_goals : ['暂无显式排除项（待评审确认）'])
    .forEach((ng) => body.push(wP(`• ${ng}`)));

  body.push(wP('二、现状材料与多源输入溯源', { style: 'Heading1' }));
  body.push(wP('2.1 现状画面截图与基准说明', { style: 'Heading2' }));
  if (prd.images.length) {
    prd.images.forEach((img, idx) => {
      body.push(wP(`图 ${idx + 1}：${img.title}（状态：${img.state}｜来源：${img.source}）`, { bold: true }));
      if (!img.missing && img.bytes) {
        const ext = img.mime === 'image/jpeg' ? '.jpg' : '.png';
        const mediaName = `image${mediaEntries.length + 1}${ext}`;
        const relId = `rIdImg${mediaEntries.length + 1}`;
        mediaEntries.push({ name: `word/media/${mediaName}`, data: img.bytes });
        imgRels.push([relId, `media/${mediaName}`]);
        body.push(wInlineImage(relId, idx + 1, img.title, img.width, img.height));
      } else {
        body.push(wP(`【现状截图待补充】预期来源：${img.source}（注：不以新绘制线框冒充现状截图）`, {
          color: 'B45309', shading: 'FFFBEB', leftBorder: 'F59E0B',
        }));
      }
      if (img.note) body.push(wP(`现状说明：${img.note}`, { color: '475569', sizeHalfPt: 19 }));
    });
  } else {
    body.push(wP('当前尚未提供现状截图（待补充）。', { color: '64748B' }));
  }

  if (prd.feedback.length) {
    body.push(wP('2.2 外部反馈、内部评审与线上检索建议台账', { style: 'Heading2' }));
    body.push(wTable(
      ['类别', '来源', '核心内容与原意', '采纳状态', '方案影响'],
      prd.feedback.map((fb) => [fb.category, fb.source, fb.content, fb.decision, fb.impact || '—']),
    ));
  }

  body.push(wP('三、业务流程展示', { style: 'Heading1' }));
  if (prd.flow.length) {
    const chain = prd.flow.map((st) => `[${st.step}] ${st.title}`).join('  →  ');
    body.push(wP(`主路径概览：${chain}`, { bold: true, shading: 'EFF6FF', leftBorder: '1D4ED8' }));
    body.push(wTable(
      ['步骤', '角色', '节点名称', '触发操作', '预期可见结果'],
      prd.flow.map((st) => [st.step, st.role, st.title, st.action, st.result]),
    ));
  } else {
    body.push(wP('待补充主流程步骤。', { color: '64748B' }));
  }

  if (prd.branches.length) {
    body.push(wP('3.2 关键分支与异常闭环', { style: 'Heading2' }));
    body.push(wTable(
      ['分支场景', '触发条件', '处理动作', '预期结果'],
      prd.branches.map((br) => [br.name, br.when, br.action, br.result]),
      { headerFill: 'FEF3C7' },
    ));
  }

  body.push(wP('四、产品原型图与关键状态说明', { style: 'Heading1' }));
  prd.screens.forEach((sc, idx) => {
    body.push(wP(`4.${idx + 1} ${sc.name}（${sc.state}）`, { style: 'Heading2' }));
    body.push(wWireframeBox(sc, idx + 1));
    body.push(wP(''));
  });

  body.push(wP('五、功能需求细化', { style: 'Heading1' }));
  if (prd.sections.length) {
    prd.sections.forEach((sec, idx) => {
      body.push(wP(`5.${idx + 1} ${sec.heading}${sec.origin ? `（来源：${sec.origin}）` : ''}`, { style: 'Heading2' }));
      if (sec.summary) body.push(wP(sec.summary));
      sec.items.forEach((it) => body.push(wP(`• ${it.origin ? `[${it.origin}] ` : ''}${it.text}`)));
    });
  } else {
    body.push(wP('详见各原型屏交互说明与验收标准。'));
  }

  body.push(wP('六、验收标准与待确认事项', { style: 'Heading1' }));
  if (prd.acceptance.length) {
    body.push(wTable(
      ['编号', '前置条件与状态', '执行操作', '预期可见结果'],
      prd.acceptance.map((ac) => [ac.id, ac.precondition, ac.action, ac.expected]),
      { headerFill: 'CCFBF1' },
    ));
  }
  if (prd.open_questions.length) {
    body.push(wP('6.2 待确认问题（Open Questions）', { style: 'Heading2' }));
    prd.open_questions.forEach((q) => body.push(wP(`• [待确认] ${q}`, { color: 'B45309', shading: 'FFFBEB', leftBorder: 'F59E0B' })));
  }
  if (prd.materials.length) {
    body.push(wP('附录：参考资料来源台账', { style: 'Heading2' }));
    body.push(wTable(
      ['资料名称', '资料类型', '读取与处理说明'],
      prd.materials.map((m) => [m.name, m.kind, m.note || '已读取']),
    ));
  }

  const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${body.join('')}${sectPr}</w:body></w:document>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    imgRels.map(([rid, target]) =>
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`
    ).join('') +
    `</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const zipBuf = writeZip([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: STYLES_XML },
    { name: 'word/_rels/document.xml.rels', data: docRelsXml },
    ...mediaEntries,
  ]);
  fs.writeFileSync(outPath, zipBuf);
}

export function exportPrdBundle(sourceJsonPath, outDir) {
  const absSource = path.resolve(sourceJsonPath);
  const absOut = path.resolve(outDir);
  const raw = JSON.parse(fs.readFileSync(absSource, 'utf8'));
  const prd = normalizePrd(raw, path.dirname(absSource));
  const menuState = computeMenuState(raw);

  fs.mkdirSync(absOut, { recursive: true });
  const docxPath = path.join(absOut, 'PRD.docx');
  const figmaPath = path.join(absOut, 'PRD.figma.json');

  writeDocx(prd, docxPath);
  const figmaSpec = buildFigmaSpec(prd);
  fs.writeFileSync(figmaPath, `${JSON.stringify(figmaSpec, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    title: prd.title,
    status: prd.status,
    docx: docxPath,
    figma_spec: figmaPath,
    single_page_board: figmaSpec.frames[0].name,
    stats: {
      flow_steps: prd.flow.length,
      branches: prd.branches.length,
      screens: prd.screens.length,
      embedded_images: prd.images.filter((i) => !i.missing).length,
      missing_images: prd.images.filter((i) => i.missing).map((i) => i.title),
      acceptance_items: prd.acceptance.length,
      open_questions: prd.open_questions.length,
    },
    menu_state: menuState,
  };
}
