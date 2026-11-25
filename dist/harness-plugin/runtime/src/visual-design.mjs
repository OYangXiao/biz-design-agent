// 角色二（美工 / UI 设计师）纯 Node 高保真视觉源稿引擎：团队规范校验、多状态源稿规格生成、本地样式/组件注册清单与模式三对话菜单
import fs from 'node:fs';
import path from 'node:path';

const NEUTRAL_EXPLORATION_TOKENS = {
  paper: '#F8F9FA',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  ink: '#1E293B',
  inkSecondary: '#475569',
  muted: '#64748B',
  line: '#CBD5E1',
  accent: '#334155',
  coverBg: '#E2E8F0',
  coverInk: '#1E293B',
  coverAccent: '#64748B',
  activeBg: '#E2E8F0',
  activeInk: '#0F172A',
  displayFont: 'PingFang SC',
  bodyFont: 'PingFang SC',
  monoFont: 'Menlo',
};

function txt(text, { size = 14, weight = 400, color = '#111111', font = null, w = 'fill', lineHeight = null, letterSpacing = null, align = 'LEFT', name = null } = {}) {
  const n = { type: 'TEXT', text: String(text), size, weight, color, align };
  if (name) n.name = name;
  if (font) n.font = font;
  if (w !== null) n.w = w;
  if (lineHeight !== null) n.lineHeight = lineHeight;
  if (letterSpacing !== null) n.letterSpacing = letterSpacing;
  return n;
}

function pill(label, bg, fg, { size = 11, pad = [4, 10], stroke = null } = {}) {
  const f = {
    type: 'FRAME',
    name: `Badge · ${String(label).slice(0, 16)}`,
    layout: 'H',
    w: 'hug',
    h: 'hug',
    pad,
    radius: 6,
    fill: bg,
    cross: 'CENTER',
    children: [txt(label, { size, weight: 600, color: fg, w: null })],
  };
  if (stroke) f.stroke = stroke;
  return f;
}

/* ============================================================================
 * 1. 模式三（美工 / UI 设计师高保真视觉稿）对话菜单状态机（含 0. 退出当前模式）
 * ========================================================================== */

export function computeVisualMenuState(visual) {
  const screens = visual?.screens || [];
  const profile = visual?.team_profile || {};
  const hasApprovedProfile = Boolean(profile.approved_by && profile.team && profile.revision);
  const tokens = visual?.tokens || {};
  const tokenCount = Object.keys(tokens).length;
  const components = visual?.components || [];
  const statesCovered = [...new Set(screens.map((s) => s.state).filter(Boolean))];
  const realCopyOk = screens.every((s) => !JSON.stringify(s).includes('Lorem ipsum'));

  const options = [
    {
      id: 1,
      label: '接入或核对团队设计规范（色板 Token、字阶、组件库与必守项）',
      enabled: true,
      status: hasApprovedProfile
        ? `已锁定团队卡：${profile.team}/${profile.product} r${profile.revision}（确认人：${profile.approved_by}）`
        : `当前为探索草案（已配 ${tokenCount} 项探索 Token，未声明符合真实品牌签收）`,
    },
    {
      id: 2,
      label: '从已确认的线稿原型导入屏幕并补齐全部必画状态',
      enabled: true,
      status: `当前共 ${screens.length} 屏（覆盖状态：${statesCovered.join(' / ') || '待补充'}）`,
    },
    {
      id: 3,
      label: '配置或复用 Figma 本地样式（Paint/Text Styles）与真实主组件',
      enabled: true,
      status: `已声明 ${components.length} 个可复用组件模板`,
    },
    {
      id: 4,
      label: '核对真实长度文案、点击热区与视觉排版防裁切自检',
      enabled: screens.length > 0,
      status: realCopyOk ? '未检测到占位假文（Lorem ipsum），可继续细调文案与间距' : '存在占位假文，请替换为真实长度文案',
    },
    {
      id: 5,
      label: '输出高保真视觉源稿到 Figma 视觉页并导出基准 PNG（供开发与对图）',
      enabled: screens.length > 0,
      status: screens.length >= 2 ? '已就绪：生成可编辑源稿 + 本地样式 + 1x/2x 基准图' : '建议补齐全部交互状态屏后再输出',
    },
    {
      id: 0,
      label: '退出当前视觉设计模式（保存设计草稿，返回主菜单切换 PRD、原型、开发或验收模式）',
      enabled: true,
      status: '随时可切换角色或工作模式',
    },
  ];

  return {
    mode: 'visual-design',
    title: visual?.title || '未命名高保真视觉稿',
    has_approved_team_profile: hasApprovedProfile,
    signoff_label: hasApprovedProfile
      ? `采用已批准规范 ${profile.team}@r${profile.revision}`
      : '探索草案（缺已批准团队规范卡，不宣称完成品牌签收）',
    screen_count: screens.length,
    states_covered: statesCovered,
    component_count: components.length,
    ready_for_export: screens.length > 0 && realCopyOk,
    options,
    post_export_options: [
      { id: 1, label: '继续调整当前高保真视觉稿（就地 patch，不清空画布）' },
      { id: 2, label: '移交研发人员提取开发规格并开始联调（进入模式 4）' },
      { id: 3, label: '移交测试与美工走查验收（进入模式 5）' },
      { id: 0, label: '退出当前模式，返回主菜单切换其他角色或任务' },
    ],
  };
}

/* ============================================================================
 * 2. 从已确认线稿原型推导初始高保真视觉草稿
 * ========================================================================== */

export function deriveVisualFromPrototype(protoRaw, { protoPath = '', teamProfile = null, tokens = null } = {}) {
  const mergedTokens = { ...NEUTRAL_EXPLORATION_TOKENS, ...(tokens || {}) };
  const screens = (protoRaw.screens || []).map((sc, idx) => ({
    id: sc.id || `visual-${String(idx + 1).padStart(2, '0')}`,
    name: sc.name || `0${idx + 1} 视觉屏`,
    state: sc.state || '默认态',
    brand_title: sc.nav_title || '产品标题',
    logo_char: (sc.nav_title || '产')[0],
    nav_action: sc.nav_left || sc.nav_right || null,
    nav_is_back: Boolean(sc.nav_left),
    elements: sc.elements || [],
    footer: null,
    spec_notes: [
      ...(sc.prd_refs || []).slice(0, 2),
      '组件与样式均绑定本地 Token，最小交互热区 >= 44px',
    ],
  }));

  return {
    title: `${(protoRaw.title || '业务功能').replace(/\s*·?\s*可交互线稿原型$/, '')} · 高保真视觉稿`,
    version: protoRaw.version || 'v1.0',
    updated_at: protoRaw.updated_at || new Date().toISOString().slice(0, 10),
    surface: protoRaw.surface || 'mobile',
    viewport: protoRaw.surface === 'desktop' ? { w: 1280, h: 800 } : { w: 390, h: 844 },
    team_profile: teamProfile || {
      team: null,
      product: null,
      revision: null,
      approved_by: null,
      note: '探索稿：未提供已批准团队规范卡，视觉色板仅作本单演示假设',
    },
    source_prototype: {
      title: protoRaw.title || '',
      path: protoPath,
    },
    tokens: mergedTokens,
    components: [
      { name: 'Header/TopBar', role: '顶栏导航（品牌标 + 右侧动作入口，高度 70px）' },
      { name: 'Button/PrimaryToggle', role: '主操作切换按钮（未激活/已激活双态，热区 120×48px）' },
      { name: 'Card/ListRow', role: '列表条目（缩略徽章 + 标题 + 副标 + 箭头，高度 >= 82px）' },
    ],
    entry_screen: protoRaw.entry_screen || screens[0]?.id || screens[0]?.name || '',
    flow_name: protoRaw.flow_name || '高保真视觉主流程预览',
    screens,
  };
}

/* ============================================================================
 * 3. 构建可编辑的高保真 Figma 源稿规格（Visual.figma.json + Styles 注册清单）
 * ========================================================================== */

function resolveMap(screens) {
  const map = new Map();
  for (const s of screens) {
    if (s.id) map.set(s.id, s.name);
    if (s.name) map.set(s.name, s.name);
  }
  return map;
}

function buildVisualBlock(el, idx, T, registerLink) {
  const kind = String(el.kind || 'card').toLowerCase();

  if (kind === 'editorial_cover') {
    return {
      type: 'FRAME',
      name: '视觉封面 · EditorialCover',
      layout: 'V',
      w: 'fill',
      h: 174,
      pad: [14, 17, 12, 17],
      main: 'SPACE_BETWEEN',
      radius: 4,
      fill: T.coverBg,
      clip: true,
      children: [
        {
          type: 'ELLIPSE',
          name: '表盘外环',
          positioning: 'ABSOLUTE',
          x: 181,
          y: -27,
          w: 210,
          h: 210,
          fill: null,
          stroke: T.coverAccent,
          strokeWeight: 1,
          dash: [2, 5],
        },
        {
          type: 'ELLIPSE',
          name: '表盘内盘',
          positioning: 'ABSOLUTE',
          x: 190,
          y: -18,
          w: 192,
          h: 192,
          fill: T.coverAccent,
          stroke: T.coverInk,
          strokeWeight: 1,
        },
        {
          type: 'RECT',
          name: '表盘指针',
          positioning: 'ABSOLUTE',
          x: 204,
          y: 74,
          w: 82,
          h: 2,
          fill: T.coverInk,
          rotate: -34,
        },
        txt(el.plate || 'EDITORIAL / ESSAYS', {
          name: '封面角标',
          size: 11,
          weight: 600,
          color: T.coverInk,
          font: T.monoFont,
          letterSpacing: 1,
        }),
        txt(el.numeral || '10′', {
          name: '封面大字号数字',
          size: 76,
          weight: 700,
          color: T.coverInk,
          font: T.displayFont,
          lineHeight: 82,
        }),
        {
          type: 'FRAME',
          name: '封面底栏',
          layout: 'H',
          w: 'fill',
          h: 'hug',
          pad: [6, 0, 0, 0],
          main: 'SPACE_BETWEEN',
          fill: null,
          children: [
            txt(el.left_caption || '时间练习', { size: 11, weight: 600, color: T.coverInk, w: null }),
            txt(el.right_caption || 'PLATE 01', { size: 11, weight: 600, color: T.coverInk, font: T.monoFont, w: null }),
          ],
        },
      ],
    };
  }

  if (kind === 'article' || kind === 'hero') {
    const paragraphs = Array.isArray(el.paragraphs)
      ? el.paragraphs
      : String(el.detail || '').split(/\n+/).filter(Boolean);
    return {
      type: 'FRAME',
      name: `正文内容 · ${String(el.label || '').slice(0, 12)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      gap: 10,
      fill: null,
      children: [
        ...(el.eyebrow
          ? [{
              type: 'FRAME',
              name: '眉标行',
              layout: 'H',
              w: 'fill',
              h: 'hug',
              main: 'SPACE_BETWEEN',
              cross: 'CENTER',
              fill: null,
              children: [
                txt(el.eyebrow, { size: 12, weight: 600, color: T.accent, w: null }),
                ...(el.issue_no ? [txt(el.issue_no, { size: 11, weight: 600, color: T.accent, font: T.monoFont, w: null })] : []),
              ],
            }]
          : []),
        txt(el.label || '文章标题', {
          name: '文章主标题',
          size: 30,
          weight: 700,
          color: T.ink,
          font: T.displayFont,
          lineHeight: 42,
        }),
        ...(el.meta
          ? [txt(el.meta, { name: '作者与阅读时长', size: 13, color: T.muted, lineHeight: 18 })]
          : []),
        { type: 'RECT', name: '正文分隔线', w: 'fill', h: 1, fill: T.line },
        {
          type: 'FRAME',
          name: '正文段落组',
          layout: 'V',
          w: 'fill',
          h: 'hug',
          pad: [6, 0, 0, 0],
          gap: 12,
          fill: null,
          children: paragraphs.map((p, pIdx) =>
            txt(p, {
              name: `正文段 ${pIdx + 1}`,
              size: 16,
              weight: 400,
              color: T.inkSecondary,
              font: T.displayFont,
              lineHeight: 30,
            })
          ),
        },
        ...(el.end_mark
          ? [{
              type: 'FRAME',
              name: '文末收束标',
              layout: 'H',
              w: 'fill',
              h: 'hug',
              pad: [8, 0, 0, 0],
              gap: 8,
              cross: 'CENTER',
              fill: null,
              children: [
                { type: 'RECT', name: '收束短线', w: 22, h: 2, fill: T.accent },
                txt(el.end_mark, { size: 11, weight: 600, color: T.muted, font: T.monoFont, w: null }),
              ],
            }]
          : []),
      ],
    };
  }

  if (kind === 'section_heading') {
    return {
      type: 'FRAME',
      name: `页面主标题 · ${el.label || ''}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      gap: 8,
      fill: null,
      children: [
        ...(el.eyebrow
          ? [{
              type: 'FRAME',
              name: '栏目眉标',
              layout: 'H',
              w: 'fill',
              h: 'hug',
              main: 'SPACE_BETWEEN',
              fill: null,
              children: [
                txt(el.eyebrow, { size: 12, weight: 600, color: T.accent, w: null }),
                ...(el.tag ? [txt(el.tag, { size: 11, weight: 600, color: T.accent, font: T.monoFont, w: null })] : []),
              ],
            }]
          : []),
        txt(el.label || '页面标题', { size: 30, weight: 700, color: T.ink, font: T.displayFont, lineHeight: 40 }),
        ...(el.catalog_left || el.catalog_right
          ? [{
              type: 'FRAME',
              name: '目录计数栏',
              layout: 'H',
              w: 'fill',
              h: 'hug',
              pad: [12, 0, 8, 0],
              main: 'SPACE_BETWEEN',
              fill: null,
              children: [
                txt(el.catalog_left || '文章目录', { size: 11, weight: 600, color: T.muted, w: null }),
                txt(el.catalog_right || '', {
                  size: 11,
                  weight: 600,
                  color: T.muted,
                  font: /^[ -~]+$/.test(String(el.catalog_right || '')) ? T.monoFont : T.bodyFont,
                  w: null,
                }),
              ],
            }, { type: 'RECT', name: '目录底线', w: 'fill', h: 1, fill: T.ink }]
          : []),
      ],
    };
  }

  if (kind === 'list') {
    const items = el.items || [];
    return {
      type: 'FRAME',
      name: '收藏条目列表',
      layout: 'V',
      w: 'fill',
      h: 'hug',
      gap: 0,
      fill: null,
      children: items.map((item, rIdx) => {
        const it = typeof item === 'string' ? { label: item } : item;
        const rowName = `Hotspot · entry-${idx + 1}-${rIdx + 1} · ${it.label}`;
        if (it.link_to) registerLink(rowName, it.link_to, it, `点击条目「${it.label}」`);
        return {
          type: 'FRAME',
          name: rowName,
          layout: 'H',
          w: 'fill',
          h: 'hug',
          pad: [18, 0],
          gap: 14,
          cross: 'CENTER',
          fill: null,
          children: [
            {
              type: 'FRAME',
              name: '缩略徽标',
              layout: 'H',
              w: 63,
              h: 82,
              radius: 2,
              fill: T.coverBg,
              stroke: T.coverAccent,
              main: 'CENTER',
              cross: 'CENTER',
              children: [txt(it.badge || '10′', { size: 28, weight: 700, color: T.coverInk, font: T.displayFont, w: null })],
            },
            {
              type: 'FRAME',
              name: '条目文案区',
              layout: 'V',
              w: 'fill',
              h: 'hug',
              gap: 4,
              fill: null,
              children: [
                txt(it.label || '条目标题', { size: 19, weight: 700, color: T.ink, font: T.displayFont, lineHeight: 28 }),
                ...(it.detail ? [txt(it.detail, { size: 13, color: T.muted, lineHeight: 18 })] : []),
              ],
            },
            txt('›', { size: 22, weight: 400, color: T.ink, w: null }),
          ],
        };
      }),
    };
  }

  if (kind === 'empty') {
    const children = [
      {
        type: 'FRAME',
        name: '空态视觉卡片',
        layout: 'H',
        w: 63,
        h: 82,
        radius: 2,
        fill: T.coverBg,
        stroke: T.coverAccent,
        main: 'CENTER',
        cross: 'CENTER',
        children: [txt(el.symbol || '∅', { size: 30, weight: 700, color: T.coverInk, w: null })],
      },
      txt(el.label || '还没有收藏', { size: 22, weight: 700, color: T.ink, font: T.displayFont, align: 'CENTER' }),
      ...(el.detail ? [txt(el.detail, { size: 14, color: T.muted, align: 'CENTER', lineHeight: 22 })] : []),
    ];
    if (el.action_label && el.link_to) {
      const btnName = `Hotspot · empty-cta-${idx + 1}`;
      registerLink(btnName, el.link_to, el, `点击空态引导「${el.action_label}」`);
      children.push({
        type: 'FRAME',
        name: btnName,
        layout: 'H',
        w: 'hug',
        h: 44,
        pad: [10, 20],
        radius: 5,
        fill: T.ink,
        main: 'CENTER',
        cross: 'CENTER',
        children: [txt(el.action_label, { size: 14, weight: 600, color: T.paper, w: null })],
      });
    }
    return {
      type: 'FRAME',
      name: '空状态视觉区',
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: [56, 12],
      gap: 14,
      cross: 'CENTER',
      fill: null,
      children,
    };
  }

  if (kind === 'button' || kind === 'cta') {
    const isActive = el.variant === 'active';
    const btnName = `Hotspot · btn-${idx + 1} · ${el.label}`;
    if (el.link_to) registerLink(btnName, el.link_to, el, `点击按钮「${el.label}」`);
    return {
      type: 'FRAME',
      name: btnName,
      layout: 'H',
      w: 'fill',
      h: 48,
      pad: [10, 20],
      radius: 5,
      main: 'CENTER',
      cross: 'CENTER',
      fill: isActive ? T.activeBg : T.ink,
      stroke: T.ink,
      children: [txt(el.label || '操作按钮', { size: 15, weight: 600, color: isActive ? T.activeInk : T.paper, w: null })],
    };
  }

  return {
    type: 'FRAME',
    name: `信息卡 · ${String(el.label || '').slice(0, 12)}`,
    layout: 'V',
    w: 'fill',
    h: 'hug',
    pad: 14,
    gap: 6,
    radius: 6,
    fill: T.surface,
    stroke: T.line,
    children: [
      txt(el.label || '', { size: 15, weight: 600, color: T.ink }),
      ...(el.detail ? [txt(el.detail, { size: 13, color: T.muted, lineHeight: 20 })] : []),
    ],
  };
}

export function buildVisualFigmaSpec(visualRaw) {
  const T = { ...NEUTRAL_EXPLORATION_TOKENS, ...(visualRaw.tokens || {}) };
  const vp = visualRaw.viewport || (visualRaw.surface === 'desktop' ? { w: 1280, h: 800 } : { w: 390, h: 844 });
  const screenW = vp.w || 390;
  const screenH = vp.h || 844;
  const colGap = 72;
  const screenTopY = 250;
  const noteTopY = screenTopY + screenH + 28;
  const screens = visualRaw.screens || [];
  const nameMap = resolveMap(screens);

  const links = [];
  const screenFrames = [];
  const noteFrames = [];

  screens.forEach((sc, idx) => {
    const colX = idx * (screenW + colGap);
    const frameName = sc.name || `0${idx + 1} 视觉屏`;
    const jumpList = [];

    const registerLink = (hotspotName, rawTarget, cfg, desc) => {
      const toName = nameMap.get(rawTarget) || rawTarget;
      const transition = String(cfg.transition || 'SMART_ANIMATE').toUpperCase();
      links.push({
        fromWithin: frameName,
        fromName: hotspotName,
        toName,
        trigger: String(cfg.trigger || 'ON_CLICK').toUpperCase(),
        nav: String(cfg.nav || 'NAVIGATE').toUpperCase(),
        transition,
        duration: Number(cfg.duration ?? 0.22),
      });
      jumpList.push(`${desc} → ${toName}`);
    };

    // 顶栏（组件结构：Header/TopBar，70px 高）
    const navAction = sc.nav_action;
    let rightNode = txt(sc.state || '', { size: 12, color: T.muted, w: null });
    if (navAction?.label) {
      const navName = `Hotspot · nav · ${navAction.label}`;
      if (navAction.link_to) registerLink(navName, navAction.link_to, navAction, `点击顶栏「${navAction.label}」`);
      rightNode = {
        type: 'FRAME',
        name: navName,
        layout: 'H',
        w: 'hug',
        h: 44,
        pad: [8, 4],
        gap: 7,
        cross: 'CENTER',
        fill: null,
        children: [
          ...(!sc.nav_is_back
            ? [{
                type: 'FRAME',
                name: '书签线标',
                layout: 'V',
                w: 11,
                h: 14,
                radius: 2,
                fill: null,
                stroke: T.ink,
                strokeWeight: 1.5,
              }]
            : []),
          txt(sc.nav_is_back ? `← ${navAction.label}` : navAction.label, {
            size: 15,
            weight: 500,
            color: T.ink,
            w: null,
          }),
        ],
      };
    }

    const headerNode = {
      type: 'FRAME',
      name: 'Header/TopBar',
      layout: 'V',
      w: 'fill',
      h: 70,
      pad: [0, 24],
      main: 'MAX',
      fill: T.paper,
      children: [
        {
          type: 'FRAME',
          name: '顶栏内容行',
          layout: 'H',
          w: 'fill',
          h: 69,
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          fill: null,
          children: [
            {
              type: 'FRAME',
              name: '品牌标识组',
              layout: 'H',
              w: 'hug',
              h: 'hug',
              gap: 9,
              cross: 'CENTER',
              fill: null,
              children: [
                {
                  type: 'FRAME',
                  name: '品牌印章',
                  layout: 'H',
                  w: 27,
                  h: 27,
                  fill: T.ink,
                  main: 'CENTER',
                  cross: 'CENTER',
                  children: [txt(sc.logo_char || '日', { size: 17, weight: 700, color: T.paper, font: T.displayFont, w: null })],
                },
                txt(sc.brand_title || '日间阅读', {
                  name: '品牌名称',
                  size: 20,
                  weight: 700,
                  color: T.ink,
                  font: T.displayFont,
                  letterSpacing: 1.5,
                  w: null,
                }),
              ],
            },
            rightNode,
          ],
        },
        { type: 'RECT', name: '顶栏下边线', w: 'fill', h: 1, fill: T.ink },
      ],
    };

    const bodyNodes = (sc.elements || []).map((el, eIdx) => buildVisualBlock(el, eIdx, T, registerLink));
    const mainBody = {
      type: 'FRAME',
      name: '主内容视口区',
      layout: 'V',
      w: 'fill',
      h: 'fill',
      pad: [20, 24, 16, 24],
      gap: 18,
      fill: T.paper,
      clip: true,
      children: bodyNodes,
    };

    let footerNode = null;
    if (sc.footer) {
      const f = sc.footer;
      const isActive = Boolean(f.pressed);
      const ctaName = `Hotspot · Button/Favorite · ${f.button_label}`;
      if (f.link_to) registerLink(ctaName, f.link_to, f, `点击底部主按钮「${f.button_label}」`);
      footerNode = {
        type: 'FRAME',
        name: 'Footer/ActionBar',
        layout: 'V',
        w: 'fill',
        h: 'hug',
        fill: T.paper,
        children: [
          { type: 'RECT', name: '底栏上边线', w: 'fill', h: 1, fill: T.line },
          {
            type: 'FRAME',
            name: '底栏操作区',
            layout: 'H',
            w: 'fill',
            h: 76,
            pad: [12, 24, 16, 24],
            main: 'SPACE_BETWEEN',
            cross: 'CENTER',
            fill: T.paper,
            children: [
              {
                type: 'FRAME',
                name: '底栏手记文案',
                layout: 'V',
                w: 'hug',
                h: 'hug',
                gap: 2,
                fill: null,
                children: [
                  txt(f.mono_label || 'READING NOTES', { size: 11, weight: 600, color: T.ink, font: T.monoFont, w: null }),
                  txt(f.sub_label || '日间阅读手记', { size: 12, color: T.muted, w: null }),
                ],
              },
              {
                type: 'FRAME',
                name: ctaName,
                layout: 'H',
                w: 124,
                h: 48,
                pad: [10, 18],
                gap: 7,
                radius: 5,
                main: 'CENTER',
                cross: 'CENTER',
                fill: isActive ? T.activeBg : T.ink,
                stroke: T.ink,
                strokeWeight: 1,
                children: [
                  txt(isActive ? `★ ${f.button_label}` : `☆ ${f.button_label}`, {
                    name: '收藏按钮文案',
                    size: 15,
                    weight: 600,
                    color: isActive ? T.activeInk : T.paper,
                    w: null,
                  }),
                ],
              },
            ],
          },
        ],
      };
    }

    screenFrames.push({
      type: 'FRAME',
      name: frameName,
      layout: 'V',
      x: colX,
      y: screenTopY,
      w: screenW,
      h: screenH,
      fill: T.paper,
      clip: true,
      children: [headerNode, mainBody, ...(footerNode ? [footerNode] : [])],
    });

    // 屏外正下方：设计规格与组件追溯卡（不进入 390×844 导出基准图！）
    const specLines = sc.spec_notes || [];
    noteFrames.push({
      type: 'FRAME',
      name: `设计规格与交付说明 · ${frameName}`,
      layout: 'V',
      x: colX,
      y: noteTopY,
      w: screenW,
      h: 'hug',
      pad: 16,
      gap: 10,
      radius: 12,
      fill: '#FFFFFF',
      stroke: '#CBD5E1',
      children: [
        {
          type: 'FRAME',
          name: '规格卡头',
          layout: 'H',
          w: 'fill',
          h: 'hug',
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          fill: null,
          children: [
            pill(`状态：${sc.state}`, '#F0FDFA', '#0F766E'),
            pill(`${screenW}×${screenH} @1x`, '#F1F5F9', '#334155'),
          ],
        },
        txt(`主色板：纸底 ${T.paper} · 墨色 ${T.ink} · 强调 ${T.accent}`, { size: 12, color: '#334155', lineHeight: 18 }),
        ...specLines.map((line) => txt(`• ${line}`, { size: 12, color: '#475569', lineHeight: 18 })),
        ...(jumpList.length
          ? [txt(`交互跳转：${jumpList.join('；')}`, { size: 11, color: '#1D4ED8', lineHeight: 17 })]
          : []),
      ],
    });
  });

  const totalW = Math.max(960, screens.length * screenW + Math.max(0, screens.length - 1) * colGap);
  const signoffText = visualRaw.team_profile?.approved_by
    ? `已批准团队规范：${visualRaw.team_profile.team}/${visualRaw.team_profile.product} r${visualRaw.team_profile.revision}（${visualRaw.team_profile.approved_by}）`
    : '探索草案（未绑定已批准团队卡 · 不宣称完成品牌签收）';

  const swatchEntries = [
    ['纸底 paper', T.paper],
    ['主墨 ink', T.ink],
    ['次墨 muted', T.muted],
    ['封面 cover', T.coverBg],
    ['强调 accent', T.accent],
    ['激活 active', T.activeBg],
  ];

  const overviewCard = {
    type: 'FRAME',
    name: `00 高保真视觉总览与 Token 规范 · ${visualRaw.title || '视觉稿'}`,
    layout: 'V',
    x: 0,
    y: 0,
    w: totalW,
    h: 'hug',
    pad: [24, 30],
    gap: 14,
    radius: 16,
    fill: '#142033',
    children: [
      {
        type: 'FRAME',
        name: '视觉头标签栏',
        layout: 'H',
        wrap: true,
        w: 'fill',
        h: 'hug',
        gap: 10,
        fill: null,
        children: [
          pill('高保真可编辑源稿', '#10B981', '#0F172A', { size: 12, pad: [5, 10] }),
          pill(signoffText, '#F59E0B', '#0F172A', { size: 12, pad: [5, 10] }),
          pill(`视口 ${screenW}×${screenH} · ${screens.length} 个全状态屏`, '#1E293B', '#E2E8F0', { size: 12, pad: [5, 10] }),
        ],
      },
      txt(visualRaw.title || '高保真视觉源稿', { size: 26, weight: 700, color: '#FFFFFF' }),
      {
        type: 'FRAME',
        name: '色板 Token 预览条',
        layout: 'H',
        wrap: true,
        w: 'fill',
        h: 'hug',
        gap: 12,
        fill: null,
        children: swatchEntries.map(([label, hex]) => ({
          type: 'FRAME',
          name: `Swatch · ${label}`,
          layout: 'H',
          w: 'hug',
          h: 'hug',
          pad: [6, 10],
          gap: 8,
          radius: 8,
          fill: '#1E293B',
          cross: 'CENTER',
          children: [
            { type: 'RECT', name: `色块 ${hex}`, w: 18, h: 18, radius: 4, fill: hex, stroke: '#94A3B8' },
            txt(`${label} ${hex}`, { size: 12, color: '#E2E8F0', w: null }),
          ],
        })),
      },
    ],
  };

  const entryTarget = nameMap.get(visualRaw.entry_screen) || screens[0]?.name || null;
  const spec = {
    frames: [overviewCard, ...screenFrames, ...noteFrames],
    links,
  };
  if (entryTarget) {
    spec.flowStart = { frameName: entryTarget, name: visualRaw.flow_name || '高保真预览' };
  }
  return spec;
}

export function buildStylesPayloads(visualRaw) {
  const T = { ...NEUTRAL_EXPLORATION_TOKENS, ...(visualRaw.tokens || {}) };
  const prefix = visualRaw.style_prefix || 'AppDesign';
  return [
    { action: 'create', kind: 'paint', name: `${prefix}/Paper`, color: T.paper },
    { action: 'create', kind: 'paint', name: `${prefix}/Ink`, color: T.ink },
    { action: 'create', kind: 'paint', name: `${prefix}/Accent`, color: T.accent },
    { action: 'create', kind: 'paint', name: `${prefix}/Cover`, color: T.coverBg },
    { action: 'create', kind: 'paint', name: `${prefix}/ActiveBg`, color: T.activeBg },
    { action: 'create', kind: 'text', name: `${prefix}/Heading1`, font: T.displayFont, size: 30, weight: 700, lineHeight: 42 },
    { action: 'create', kind: 'text', name: `${prefix}/Body`, font: T.displayFont, size: 16, weight: 400, lineHeight: 30 },
  ];
}

export function exportVisualBundle(sourceJsonPath, outDir) {
  const absSource = path.resolve(sourceJsonPath);
  const absOut = path.resolve(outDir);
  const raw = JSON.parse(fs.readFileSync(absSource, 'utf8'));
  const menuState = computeVisualMenuState(raw);
  const figmaSpec = buildVisualFigmaSpec(raw);
  const stylesOps = buildStylesPayloads(raw);

  fs.mkdirSync(absOut, { recursive: true });
  const figmaPath = path.join(absOut, 'Visual.figma.json');
  const stylesPath = path.join(absOut, 'Visual-Styles.json');
  const guidePath = path.join(absOut, 'Visual-Spec.md');

  fs.writeFileSync(figmaPath, `${JSON.stringify(figmaSpec, null, 2)}\n`, 'utf8');
  fs.writeFileSync(stylesPath, `${JSON.stringify(stylesOps, null, 2)}\n`, 'utf8');

  const md = [
    `# ${raw.title || '高保真视觉交付规格'}`,
    '',
    `- **规范签收状态**：${menuState.signoff_label}`,
    `- **基准视口**：\`${raw.viewport?.w || 390}×${raw.viewport?.h || 844}\`（共 ${menuState.screen_count} 屏，覆盖：${menuState.states_covered.join('、')}）`,
    `- **点击跳转连线**：${figmaSpec.links.length} 条`,
    '',
    '## Token 色板',
    ...Object.entries(raw.tokens || {}).map(([k, v]) => `- \`${k}\`: \`${v}\``),
    '',
    '## 交付屏幕清单',
    ...(raw.screens || []).map((s, i) => `${i + 1}. **${s.name}**（${s.state}）`),
    '',
  ].join('\n');
  fs.writeFileSync(guidePath, md, 'utf8');

  return {
    ok: true,
    title: raw.title || '高保真视觉稿',
    figma_spec: figmaPath,
    styles_ops: stylesPath,
    spec_markdown: guidePath,
    stats: {
      screens: menuState.screen_count,
      styles_to_register: stylesOps.length,
      links: figmaSpec.links.length,
    },
    menu_state: menuState,
  };
}
