// 角色三（前端 / 研发人员）纯 Node 开发交接引擎：从真实 Figma dump 提取色值/字阶/真实文案与状态规格、生成提测单及模式四对话菜单
import fs from 'node:fs';
import path from 'node:path';

/* ============================================================================
 * 1. 模式四（前端 / 研发联调与提测）对话菜单状态机（含 0. 退出当前模式）
 * ========================================================================== */

export function computeDevMenuState(state = {}) {
  const hasHandoff = Boolean(state.handoff_spec_path || state.extracted_screens > 0);
  const hasReject = Boolean(state.reject_ticket_path || (state.open_defects || []).length > 0);
  const hasBuild = Boolean(state.build_id && state.test_url);
  const selfCheckPassed = Boolean(state.self_check?.functional_ok);

  const options = [
    {
      id: 1,
      label: '从 Figma 高保真视觉页（dump 节点树）与 PRD 提取开发交付规格包',
      enabled: true,
      status: hasHandoff
        ? `已提取 ${state.extracted_screens || 0} 屏视觉规格、色值/字阶与定稿文案`
        : '建议先从已签收 Figma 视觉页提取精确标注与定稿文案',
    },
    {
      id: 2,
      label: '对照 PRD 验收标准与 QA 退回修复单，梳理本次实现/修复要点',
      enabled: true,
      status: hasReject
        ? `当前有 ${(state.open_defects || []).length || 1} 项待修退回缺陷，优先定位修复`
        : '新需求实现阶段：对齐跨页状态源与边界异常规则',
    },
    {
      id: 3,
      label: '开发或更新目标页面代码（对齐真实文案、跨页共享状态与 >=44px 热区）',
      enabled: true,
      status: state.target_files?.length ? `涉及文件：${state.target_files.join(', ')}` : '可指定本地前端工程或测试页文件',
    },
    {
      id: 4,
      label: '执行研发本地自查（跑主流程自测 + 对照 Figma 基准图跑像素自检）',
      enabled: true,
      status: selfCheckPassed ? '本地自查通过，可打包提测' : '尚未完成本地自查（建议提测前自查一次防退回）',
    },
    {
      id: 5,
      label: '锁定构建号（Build ID）并生成提测单，移交 QA 验收',
      enabled: true,
      status: hasBuild ? `已登记构建 ${state.build_id}（${state.test_url}）` : '生成含测试地址、构建号与可复位样例数据的提测交接单',
    },
    {
      id: 0,
      label: '退出当前研发模式（保存联调记录，返回主菜单切换 PRD、原型、视觉或验收模式）',
      enabled: true,
      status: '随时可切换角色或工作模式',
    },
  ];

  return {
    mode: 'dev-handoff',
    title: state.title || '前端开发联调任务',
    build_id: state.build_id || null,
    has_handoff: hasHandoff,
    open_defects_count: (state.open_defects || []).length,
    ready_for_qa: hasBuild && selfCheckPassed,
    options,
    post_handoff_options: [
      { id: 1, label: '继续修改代码并更新本地自查' },
      { id: 2, label: '立即移交测试与美工走查验收（进入模式 5，携带本次构建号与测试地址）' },
      { id: 0, label: '退出当前模式，返回主菜单切换其他角色或任务' },
    ],
  };
}

/* ============================================================================
 * 2. 从真实 Figma dump JSON 自动提取开发规格（色值/字阶/圆角/真实文案/组件）
 * ========================================================================== */

function normalizeDumpRoots(dumpJson) {
  if (!dumpJson) return [];
  if (Array.isArray(dumpJson)) return dumpJson;
  if (Array.isArray(dumpJson.nodes)) return dumpJson.nodes;
  if (Array.isArray(dumpJson.frames)) return dumpJson.frames;
  if (dumpJson.node) return [dumpJson.node];
  if (dumpJson.type) return [dumpJson];
  return [];
}

function collectColors(paintsVal, counter) {
  if (!paintsVal) return;
  const list = Array.isArray(paintsVal) ? paintsVal : [paintsVal];
  for (const item of list) {
    if (typeof item === 'string' && item.startsWith('#')) {
      const hex = item.toUpperCase();
      counter.set(hex, (counter.get(hex) || 0) + 1);
    } else if (item && typeof item === 'object' && typeof item.color === 'string') {
      const hex = item.color.toUpperCase();
      counter.set(hex, (counter.get(hex) || 0) + 1);
    }
  }
}

export function extractDevSpecFromFigmaDump(dumpJson, { prdJson = null, designPage = '', designFile = '' } = {}) {
  const roots = normalizeDumpRoots(dumpJson);
  const colorCounts = new Map();
  const typographyMap = new Map();
  const componentsUsed = new Set();
  const stylesUsed = new Set();
  const screens = [];

  for (const root of roots) {
    // 跳过屏外说明卡和总览头卡，聚焦实际需要前端实现的屏幕 Frame
    const rName = String(root.name || '未命名节点');
    if (/^(00 |设计规格与交付说明|PRD映射与设计说明)/.test(rName)) continue;

    const screenCopy = [];
    const interactiveNodes = [];
    const radii = new Set();

    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      collectColors(n.fill, colorCounts);
      collectColors(n.stroke, colorCounts);
      if (typeof n.radius === 'number' && n.radius > 0) radii.add(n.radius);
      if (n.mainComponent?.name) componentsUsed.add(n.mainComponent.name);
      if (n.textStyle) stylesUsed.add(`text:${n.textStyle}`);
      if (n.fillStyle) stylesUsed.add(`fill:${n.fillStyle}`);

      if (String(n.type || '').toUpperCase() === 'TEXT') {
        const text = String(n.text ?? n.characters ?? '').trim();
        if (text) {
          screenCopy.push({ node: n.name || 'Text', text, size: n.size ?? n.fontSize ?? null, weight: n.weight ?? null });
        }
        const font = n.font || 'inherit';
        const size = n.size ?? n.fontSize ?? 14;
        const weight = n.weight ?? 400;
        const color = typeof n.color === 'string' ? n.color.toUpperCase() : (typeof n.fill === 'string' ? n.fill.toUpperCase() : '#111111');
        const key = `${font}|${weight}|${size}|${color}`;
        if (!typographyMap.has(key)) {
          typographyMap.set(key, { font, weight, size, lineHeight: n.lineHeight ?? null, color, count: 0 });
        }
        typographyMap.get(key).count++;
      }

      if (Array.isArray(n.reactions) && n.reactions.length) {
        interactiveNodes.push({
          node: n.name,
          w: n.w ?? n.width ?? null,
          h: n.h ?? n.height ?? null,
          reactions: n.reactions.length,
        });
      }

      for (const c of n.children || []) walk(c);
    };
    walk(root);

    screens.push({
      id: root.id || null,
      name: rName,
      viewport: { w: root.w ?? root.width ?? null, h: root.h ?? root.height ?? null },
      radii: [...radii].sort((a, b) => a - b),
      copy_items: screenCopy,
      interactive_nodes: interactiveNodes,
    });
  }

  const colors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex, count]) => ({ hex, count }));
  const typography = [...typographyMap.values()].sort((a, b) => b.size - a.size);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    design_source: { file: designFile || dumpJson?.file || '', page: designPage || dumpJson?.page || '' },
    prd_source: prdJson ? { title: prdJson.title, version: prdJson.version } : null,
    summary: {
      screen_count: screens.length,
      color_count: colors.length,
      typography_count: typography.length,
      components_referenced: [...componentsUsed],
      styles_referenced: [...stylesUsed],
    },
    tokens: { colors, typography },
    screens,
    state_rules: prdJson?.sections || [],
    acceptance_criteria: prdJson?.acceptance || [],
  };
}

export function renderDevHandoffMarkdown(spec) {
  const lines = [
    `# 前端开发联调规格包（Dev Handoff）`,
    '',
    `- **视觉源稿**：${spec.design_source.file || '当前 Figma 文件'} / \`${spec.design_source.page || '视觉页'}\``,
    `- **关联 PRD**：${spec.prd_source ? `${spec.prd_source.title} (${spec.prd_source.version})` : '未绑定'}`,
    `- **提取屏幕数**：${spec.summary.screen_count} 屏 · 色值 ${spec.summary.color_count} 个 · 字阶 ${spec.summary.typography_count} 组`,
    '',
    '## 1. 视觉 Token 抽取结果',
    '### 颜色色板',
    ...spec.tokens.colors.slice(0, 12).map((c) => `- \`${c.hex}\`（出现 ${c.count} 处）`),
    '',
    '### 字阶排版',
    ...spec.tokens.typography.slice(0, 12).map((t) => `- \`${t.font}\` ${t.size}px / weight ${t.weight} / \`${t.color}\`（${t.count} 处）`),
    '',
    '## 2. 各屏定稿文案与视口尺寸（严禁使用临时假文）',
  ];

  for (const sc of spec.screens) {
    lines.push(`### ${sc.name}（${sc.viewport.w || '?'}×${sc.viewport.h || '?'}）`);
    for (const item of sc.copy_items) {
      lines.push(`- **${item.node}**：${item.text.replace(/\n+/g, ' / ')}`);
    }
    lines.push('');
  }

  if (spec.acceptance_criteria.length) {
    lines.push('## 3. 提测前必过功能验收条件');
    for (const ac of spec.acceptance_criteria) {
      lines.push(`- **${ac.id}**：[${ac.precondition}] ${ac.action} → **${ac.expected}**`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function exportDevHandoff(dumpPath, outDir, { prdPath = null, designPage = '', designFile = '' } = {}) {
  const dumpJson = JSON.parse(fs.readFileSync(path.resolve(dumpPath), 'utf8'));
  const prdJson = prdPath ? JSON.parse(fs.readFileSync(path.resolve(prdPath), 'utf8')) : null;
  const spec = extractDevSpecFromFigmaDump(dumpJson, { prdJson, designPage, designFile });

  const absOut = path.resolve(outDir);
  fs.mkdirSync(absOut, { recursive: true });
  const jsonPath = path.join(absOut, 'Dev-Handoff.json');
  const mdPath = path.join(absOut, 'Dev-Handoff.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderDevHandoffMarkdown(spec), 'utf8');

  return {
    ok: true,
    handoff_json: jsonPath,
    handoff_markdown: mdPath,
    summary: spec.summary,
  };
}

export function createBuildTicket({
  buildId,
  testUrl,
  designSource = '',
  prdVersion = '',
  fixture = '干净本地存储（首次未收藏态）',
  changes = [],
  selfCheck = { functional_ok: false, visual_note: '' },
}) {
  return {
    ticket_type: 'qa-handoff',
    build_id: buildId,
    created_at: new Date().toISOString(),
    test_url: testUrl,
    design_source: designSource,
    prd_version: prdVersion,
    fixture,
    changes,
    self_check: selfCheck,
  };
}
