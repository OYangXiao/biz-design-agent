// 纯 Node.js 可交互线稿原型引擎：从 PRD 继承推导、模式二对话菜单状态检查、生成带 Figma 点击跳转（reactions + flowStart）与 PRD 设计说明卡的原型规格
import fs from 'node:fs';
import path from 'node:path';

const W = {
  headerBg: '#1E293B',
  headerSub: '#CBD5E1',
  screenBg: '#FCFCFD',
  screenBorder: '#64748B',
  chromeBg: '#F8FAFC',
  cardBg: '#FFFFFF',
  mutedBg: '#F1F5F9',
  ink: '#0F172A',
  inkSec: '#334155',
  inkMuted: '#64748B',
  border: '#CBD5E1',
  borderSoft: '#E2E8F0',
  ctaBg: '#1E293B',
  activeBg: '#F0FDFA',
  activeStroke: '#0F766E',
  activeText: '#0F766E',
  hotspotStroke: '#2563EB',
  hotspotSoft: '#EFF6FF',
  amberSoft: '#FFFBEB',
  amberStroke: '#F59E0B',
  amberText: '#B45309',
  noteCardBg: '#FFFFFF',
};

function txt(text, { size = 14, weight = 400, color = W.ink, w = 'fill', lineHeight = null, align = 'LEFT', name = null } = {}) {
  const n = { type: 'TEXT', text: String(text), size, weight, color, align };
  if (name) n.name = name;
  if (w !== null) n.w = w;
  if (lineHeight !== null) n.lineHeight = lineHeight;
  return n;
}

function tag(label, bg, fg, { size = 11, pad = [4, 8] } = {}) {
  return {
    type: 'FRAME',
    name: `Tag · ${String(label).slice(0, 16)}`,
    layout: 'H',
    w: 'hug',
    h: 'hug',
    pad,
    radius: 5,
    fill: bg,
    cross: 'CENTER',
    children: [txt(label, { size, weight: 600, color: fg, w: null })],
  };
}

/* ============================================================================
 * 1. 模式二（生成/迭代可操作原型图）对话菜单状态机（含 0. 退出当前模式）
 * ========================================================================== */

export function computePrototypeMenuState(proto) {
  const screens = proto?.screens || [];
  const screenIds = new Set(screens.map((s) => s.id || s.name));
  const screenNames = new Set(screens.map((s) => s.name));

  let linkCount = 0;
  const brokenLinks = [];
  let mappedScreens = 0;

  for (const sc of screens) {
    const hasPrdRef = Array.isArray(sc.prd_refs) && sc.prd_refs.length > 0;
    const hasWhy = Array.isArray(sc.design_rationale) ? sc.design_rationale.length > 0 : Boolean(sc.design_rationale);
    if (hasPrdRef || hasWhy) mappedScreens++;

    const collectTarget = (target, label) => {
      if (!target) return;
      linkCount++;
      if (!screenIds.has(target) && !screenNames.has(target)) {
        brokenLinks.push(`${sc.name} -> ${label} 指向不存在的目标屏「${target}」`);
      }
    };

    if (sc.nav_left?.link_to) collectTarget(sc.nav_left.link_to, sc.nav_left.label || '左导航');
    if (sc.nav_right?.link_to) collectTarget(sc.nav_right.link_to, sc.nav_right.label || '右导航');
    for (const el of sc.elements || []) {
      if (el.link_to) collectTarget(el.link_to, el.label || el.kind);
      for (const it of el.items || []) {
        if (typeof it === 'object' && it.link_to) collectTarget(it.link_to, it.label || '子项');
      }
    }
  }

  const ready = screens.length >= 2 && linkCount >= 1 && brokenLinks.length === 0;

  const options = [
    {
      id: 1,
      label: '从已有 PRD 提取或同步原型屏幕与主流程跳转',
      enabled: true,
      status: proto?.prd_ref?.title ? `已关联 PRD：《${proto.prd_ref.title}》` : '可指定工作区 PRD 自动生成初稿',
    },
    {
      id: 2,
      label: '新增、修改或删减原型屏幕及线稿细节样式',
      enabled: true,
      status: `当前共 ${screens.length} 张线稿屏幕（表面：${proto?.surface || 'mobile'}）`,
    },
    {
      id: 3,
      label: '配置或调整 Figma 点击跳转交互（Prototype 连线与预览起点）',
      enabled: screens.length > 0,
      status: brokenLinks.length
        ? `存在 ${brokenLinks.length} 条断链待修正`
        : `已配置 ${linkCount} 条点击跳转连线`,
    },
    {
      id: 4,
      label: '补充或修改「对应 PRD 条款与为什么这么设计」说明卡',
      enabled: screens.length > 0,
      status: `已完成 ${mappedScreens}/${screens.length} 屏的 PRD 映射与设计理由说明`,
    },
    {
      id: 5,
      label: '预览交互闭环并输出可点击预览的 Figma 原型页',
      enabled: screens.length > 0,
      status: ready ? '交互闭环完整，可直接生成并预览' : '建议至少包含 2 屏及 1 条有效跳转连线',
    },
    {
      id: 0,
      label: '退出当前原型图模式（保存原型草稿，返回主菜单切换 PRD、视觉稿或页面验证模式）',
      enabled: true,
      status: '随时可切换角色或工作模式',
    },
  ];

  return {
    mode: 'prototype',
    title: proto?.title || '未命名可交互线稿原型',
    prd_title: proto?.prd_ref?.title || null,
    screen_count: screens.length,
    link_count: linkCount,
    mapped_screen_count: mappedScreens,
    broken_links: brokenLinks,
    ready_for_export: ready,
    options,
  };
}

/* ============================================================================
 * 2. 从 PRD 数据源自动推导初始可交互原型草稿（无缝衔接第一步 PRD）
 * ========================================================================== */

export function derivePrototypeFromPrd(prdRaw, { prdPath = '' } = {}) {
  const prdScreens = prdRaw.screens || [];
  const flowSteps = prdRaw.flow || [];
  const acceptances = prdRaw.acceptance || [];

  const derivedScreens = prdScreens.map((sc, idx) => {
    const nextSc = prdScreens[idx + 1] || prdScreens[0] || null;
    const matchedStep = flowSteps[idx] || flowSteps[0] || null;
    const matchedAc = acceptances[idx] || acceptances[0] || null;

    const prdRefs = [];
    if (prdRaw.goal?.objectives?.[0]) prdRefs.push(`需求目标：${prdRaw.goal.objectives[Math.min(idx, prdRaw.goal.objectives.length - 1)]}`);
    if (matchedStep) prdRefs.push(`对应流程：STEP ${matchedStep.step || idx + 1}「${matchedStep.title || matchedStep.action}」`);
    if (matchedAc) prdRefs.push(`对应验收：${matchedAc.id || `AC-0${idx + 1}`}（${matchedAc.expected || matchedAc}）`);

    const elements = (sc.elements || sc.blocks || []).map((b, bIdx) => {
      if (typeof b === 'string') {
        return { kind: 'card', label: b, detail: '' };
      }
      const kind = String(b.kind || b.type || 'card').toLowerCase();
      const isPrimaryBtn = ['button', 'cta', 'actions'].includes(kind);
      return {
        kind,
        label: b.label || b.title || b.text || `元素 ${bIdx + 1}`,
        detail: b.detail || b.subtext || '',
        variant: b.variant || (b.emphasis ? 'primary' : 'secondary'),
        items: [...(b.items || [])],
        ...(isPrimaryBtn && nextSc && nextSc.name !== sc.name
          ? { link_to: nextSc.id || nextSc.name, transition: 'SMART_ANIMATE' }
          : {}),
      };
    });

    return {
      id: sc.id || `screen-${String(idx + 1).padStart(2, '0')}`,
      name: sc.name || `0${idx + 1} 原型屏幕`,
      state: sc.state || '默认态',
      nav_title: prdRaw.title?.split('·')[0]?.trim() || sc.name || '页面标题',
      nav_right: sc.nav_right
        ? {
            label: sc.nav_right,
            link_to: prdScreens[prdScreens.length - 1]?.id || prdScreens[0]?.id || '',
            transition: 'DISSOLVE',
          }
        : null,
      prd_refs: prdRefs,
      design_rationale: [
        `承接入口「${sc.entry || '主路径入口'}」，聚焦核心动作「${sc.action || '本屏主操作'}」，减少非必要视觉干扰。`,
        `状态变化结果「${sc.result || '即时反馈'}」采用显式文案与清晰线稿层级表达，便于评审直接点通验证。`,
      ],
      elements,
      footer_note: `线稿状态：${sc.state || '标准预览态'}`,
    };
  });

  return {
    title: `${prdRaw.title?.replace(/\s*PRD$/i, '') || '业务需求'} · 可交互线稿原型`,
    version: prdRaw.version || 'v1.0',
    updated_at: prdRaw.updated_at || new Date().toISOString().slice(0, 10),
    surface: prdRaw.surface || 'mobile',
    flow_name: '核心业务主流程预览',
    entry_screen: derivedScreens[0]?.id || derivedScreens[0]?.name || '',
    prd_ref: {
      title: prdRaw.title || '关联需求 PRD',
      version: prdRaw.version || 'v1.0',
      source_path: prdPath,
      summary: prdRaw.goal?.summary || prdRaw.subtitle || '',
    },
    screens: derivedScreens,
  };
}

/* ============================================================================
 * 3. 构建可点击预览的 Figma 原型规格（顶层设备 Frame + 屏外 PRD 说明卡 + links）
 * ========================================================================== */

function resolveScreenNameMap(screens) {
  const map = new Map();
  for (const sc of screens) {
    if (sc.id) map.set(sc.id, sc.name);
    if (sc.name) map.set(sc.name, sc.name);
  }
  return map;
}

function buildInteractiveHotspotPill(label, hotspotName, { isLinked = false, primary = false } = {}) {
  return {
    type: 'FRAME',
    name: hotspotName,
    layout: 'H',
    w: 'hug',
    h: 32,
    pad: [6, 12],
    gap: 4,
    radius: 6,
    cross: 'CENTER',
    fill: primary ? W.ctaBg : (isLinked ? W.hotspotSoft : '#FFFFFF'),
    stroke: primary ? W.ctaBg : (isLinked ? W.hotspotStroke : W.border),
    children: [
      txt(isLinked ? `${label} ↗` : label, {
        size: 12,
        weight: 600,
        color: primary ? '#FFFFFF' : (isLinked ? W.hotspotStroke : W.inkSec),
        w: null,
      }),
    ],
  };
}

function buildScreenElement(el, elIdx, registerLink) {
  const kind = String(el.kind || 'card').toLowerCase();
  const label = el.label || '';
  const detail = el.detail || '';

  if (['article', 'hero', 'content'].includes(kind)) {
    return {
      type: 'FRAME',
      name: `正文区 · ${label.slice(0, 12)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: 16,
      gap: 10,
      radius: 10,
      fill: '#FFFFFF',
      stroke: W.borderSoft,
      children: [
        ...(el.eyebrow ? [txt(el.eyebrow, { size: 11, weight: 600, color: W.inkMuted })] : []),
        txt(label, { size: 20, weight: 700, color: W.ink, lineHeight: 28 }),
        ...(detail ? [txt(detail, { size: 14, color: W.inkSec, lineHeight: 23 })] : []),
      ],
    };
  }

  if (['button', 'cta'].includes(kind)) {
    const hotspotName = `Hotspot · btn-${elIdx + 1} · ${label}`;
    const variant = String(el.variant || 'primary').toLowerCase();
    const isLinked = Boolean(el.link_to);
    if (isLinked) registerLink(hotspotName, el.link_to, el, `点击按钮「${label}」`);

    let fill = W.ctaBg;
    let stroke = W.ctaBg;
    let fg = '#FFFFFF';
    if (variant === 'active' || variant === 'selected') {
      fill = W.activeBg;
      stroke = W.activeStroke;
      fg = W.activeText;
    } else if (variant === 'secondary' || variant === 'outline') {
      fill = '#FFFFFF';
      stroke = isLinked ? W.hotspotStroke : W.border;
      fg = isLinked ? W.hotspotStroke : W.ink;
    }

    return {
      type: 'FRAME',
      name: hotspotName,
      layout: 'H',
      w: 'fill',
      h: 46,
      pad: [10, 18],
      gap: 8,
      radius: 8,
      main: 'CENTER',
      cross: 'CENTER',
      fill,
      stroke,
      strokeWeight: variant === 'active' || isLinked ? 1.5 : 1,
      children: [
        txt(isLinked ? `${label}  ↗` : label, { size: 14, weight: 600, color: fg, w: null }),
        ...(detail ? [txt(`· ${detail}`, { size: 11, color: variant === 'primary' ? '#CBD5E1' : W.inkMuted, w: null })] : []),
      ],
    };
  }

  if (kind === 'list') {
    const items = el.items || [];
    const rows = items.map((item, rIdx) => {
      const itemObj = typeof item === 'string' ? { label: item } : item;
      const rLabel = itemObj.label || itemObj.title || `条目 ${rIdx + 1}`;
      const rMeta = itemObj.detail || itemObj.meta || '';
      const rowName = `Hotspot · row-${elIdx + 1}-${rIdx + 1} · ${rLabel.slice(0, 14)}`;
      const isLinked = Boolean(itemObj.link_to);
      if (isLinked) registerLink(rowName, itemObj.link_to, itemObj, `点击列表项「${rLabel}」`);

      return {
        type: 'FRAME',
        name: rowName,
        layout: 'H',
        w: 'fill',
        h: 'hug',
        pad: [14, 14],
        gap: 10,
        radius: 8,
        fill: '#FFFFFF',
        stroke: isLinked ? W.hotspotStroke : W.border,
        main: 'SPACE_BETWEEN',
        cross: 'CENTER',
        children: [
          {
            type: 'FRAME',
            name: '列表文案组',
            layout: 'V',
            w: 'fill',
            h: 'hug',
            gap: 3,
            fill: null,
            children: [
              txt(rLabel, { size: 14, weight: 600, color: W.ink }),
              ...(rMeta ? [txt(rMeta, { size: 12, color: W.inkMuted })] : []),
            ],
          },
          txt(isLinked ? '打开 ↗' : '›', { size: 12, weight: 600, color: isLinked ? W.hotspotStroke : W.inkMuted, w: null }),
        ],
      };
    });

    return {
      type: 'FRAME',
      name: `列表容器 · ${label.slice(0, 12)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      gap: 8,
      fill: null,
      children: [
        ...(label ? [txt(label, { size: 12, weight: 600, color: W.inkMuted })] : []),
        ...rows,
      ],
    };
  }

  if (['tabs', 'segmented'].includes(kind)) {
    const items = el.items || [];
    return {
      type: 'FRAME',
      name: `分段切换 · ${label.slice(0, 10)}`,
      layout: 'H',
      w: 'fill',
      h: 'hug',
      pad: 4,
      gap: 6,
      radius: 8,
      fill: W.mutedBg,
      children: items.map((it, tIdx) => {
        const itObj = typeof it === 'string' ? { label: it, active: tIdx === 0 } : it;
        const active = Boolean(itObj.active);
        const tabName = `Hotspot · tab-${elIdx + 1}-${tIdx + 1} · ${itObj.label}`;
        if (itObj.link_to) registerLink(tabName, itObj.link_to, itObj, `切换分段「${itObj.label}」`);
        return {
          type: 'FRAME',
          name: tabName,
          layout: 'H',
          w: 'fill',
          h: 34,
          pad: [6, 8],
          radius: 6,
          main: 'CENTER',
          cross: 'CENTER',
          fill: active ? W.ctaBg : (itObj.link_to ? '#FFFFFF' : W.mutedBg),
          stroke: (!active && itObj.link_to) ? W.hotspotStroke : null,
          children: [
            txt(itObj.link_to && !active ? `${itObj.label} ↗` : itObj.label, {
              size: 12,
              weight: active ? 600 : 500,
              color: active ? '#FFFFFF' : (itObj.link_to ? W.hotspotStroke : W.inkSec),
              w: null,
            }),
          ],
        };
      }),
    };
  }

  if (kind === 'empty') {
    const children = [
      {
        type: 'FRAME',
        name: '线稿占位图标框',
        layout: 'H',
        w: 56,
        h: 56,
        radius: 12,
        fill: '#FFFFFF',
        stroke: W.border,
        dash: [3, 3],
        main: 'CENTER',
        cross: 'CENTER',
        children: [txt('∅', { size: 22, weight: 600, color: W.inkMuted, w: null })],
      },
      txt(label || '暂无内容', { size: 15, weight: 600, color: W.inkSec, align: 'CENTER' }),
      ...(detail ? [txt(detail, { size: 12, color: W.inkMuted, align: 'CENTER', lineHeight: 18 })] : []),
    ];

    if (el.action_label && el.link_to) {
      const emptyBtnName = `Hotspot · empty-btn-${elIdx + 1} · ${el.action_label}`;
      registerLink(emptyBtnName, el.link_to, el, `点击空态引导「${el.action_label}」`);
      children.push(buildInteractiveHotspotPill(el.action_label, emptyBtnName, { isLinked: true }));
    }

    return {
      type: 'FRAME',
      name: `空状态框 · ${label.slice(0, 10)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: [36, 20],
      gap: 10,
      radius: 10,
      fill: W.chromeBg,
      stroke: W.border,
      dash: [5, 5],
      cross: 'CENTER',
      children,
    };
  }

  if (['input', 'search'].includes(kind)) {
    return {
      type: 'FRAME',
      name: `输入框 · ${label.slice(0, 10)}`,
      layout: 'H',
      w: 'fill',
      h: 44,
      pad: [10, 14],
      radius: 8,
      fill: '#FFFFFF',
      stroke: W.border,
      main: 'SPACE_BETWEEN',
      cross: 'CENTER',
      children: [
        txt(label || '请输入...', { size: 13, color: W.inkMuted, w: null }),
        txt(detail || '输入域', { size: 11, color: W.inkMuted, w: null }),
      ],
    };
  }

  if (['banner', 'notice', 'toast'].includes(kind)) {
    return {
      type: 'FRAME',
      name: `边界状态条 · ${label.slice(0, 10)}`,
      layout: 'V',
      w: 'fill',
      h: 'hug',
      pad: [10, 12],
      gap: 3,
      radius: 8,
      fill: W.amberSoft,
      stroke: W.amberStroke,
      children: [
        txt(label, { size: 12, weight: 600, color: W.amberText }),
        ...(detail ? [txt(detail, { size: 11, color: W.inkSec, lineHeight: 17 })] : []),
      ],
    };
  }

  // 默认线稿信息卡
  const cardName = el.link_to ? `Hotspot · card-${elIdx + 1} · ${label.slice(0, 12)}` : `线稿卡片 · ${label.slice(0, 12)}`;
  if (el.link_to) registerLink(cardName, el.link_to, el, `点击卡片「${label}」`);
  return {
    type: 'FRAME',
    name: cardName,
    layout: 'V',
    w: 'fill',
    h: 'hug',
    pad: 14,
    gap: 6,
    radius: 8,
    fill: '#FFFFFF',
    stroke: el.link_to ? W.hotspotStroke : W.border,
    children: [
      txt(el.link_to ? `${label} ↗` : label, { size: 14, weight: 600, color: el.link_to ? W.hotspotStroke : W.ink }),
      ...(detail ? [txt(detail, { size: 12, color: W.inkMuted, lineHeight: 18 })] : []),
    ],
  };
}

export function buildPrototypeFigmaSpec(proto) {
  const surface = String(proto.surface || 'mobile').toLowerCase();
  const isDesktop = surface === 'desktop';
  const screenW = isDesktop ? 1040 : 390;
  const screenH = isDesktop ? 700 : 844;
  const colGap = 72;
  const screenTopY = 210;
  const noteTopY = screenTopY + screenH + 28;

  const screens = proto.screens || [];
  const nameMap = resolveScreenNameMap(screens);
  const allLinks = [];
  const screenFrames = [];
  const noteFrames = [];

  screens.forEach((sc, idx) => {
    const colX = idx * (screenW + colGap);
    const screenFrameName = sc.name || `0${idx + 1} 原型屏`;
    const perScreenJumpDocs = [];

    const registerLink = (hotspotName, rawTarget, cfg, actionLabel) => {
      const toName = nameMap.get(rawTarget) || rawTarget;
      const transition = String(cfg.transition || 'SMART_ANIMATE').toUpperCase();
      const nav = String(cfg.nav || 'NAVIGATE').toUpperCase();
      allLinks.push({
        fromWithin: screenFrameName,
        fromName: hotspotName,
        toName,
        trigger: String(cfg.trigger || 'ON_CLICK').toUpperCase(),
        nav,
        transition,
        duration: Number(cfg.duration ?? 0.22),
      });
      perScreenJumpDocs.push(`${actionLabel} → 跳转「${toName}」（${transition}）`);
    };

    // 1) 状态栏（仅移动端线稿展示）
    const statusBar = !isDesktop
      ? {
          type: 'FRAME',
          name: '手机状态栏',
          layout: 'H',
          w: 'fill',
          h: 36,
          pad: [8, 20],
          fill: W.chromeBg,
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          children: [
            txt('9:41', { size: 12, weight: 600, color: W.ink, w: null }),
            txt('5G · 100%', { size: 11, weight: 500, color: W.inkMuted, w: null }),
          ],
        }
      : null;

    // 2) 顶部导航栏（支持左/右可点击跳转热区）
    const navChildren = [];
    if (sc.nav_left?.label) {
      const leftName = `Hotspot · nav-left · ${sc.nav_left.label}`;
      if (sc.nav_left.link_to) registerLink(leftName, sc.nav_left.link_to, sc.nav_left, `点击顶栏左侧「${sc.nav_left.label}」`);
      navChildren.push(buildInteractiveHotspotPill(sc.nav_left.label, leftName, { isLinked: Boolean(sc.nav_left.link_to) }));
    }
    navChildren.push(txt(sc.nav_title || sc.name, { size: 15, weight: 700, color: W.ink, w: null }));
    if (sc.nav_right?.label) {
      const rightName = `Hotspot · nav-right · ${sc.nav_right.label}`;
      if (sc.nav_right.link_to) registerLink(rightName, sc.nav_right.link_to, sc.nav_right, `点击顶栏右侧「${sc.nav_right.label}」`);
      navChildren.push(buildInteractiveHotspotPill(sc.nav_right.label, rightName, { isLinked: Boolean(sc.nav_right.link_to) }));
    } else {
      navChildren.push(tag(sc.state || '线稿', W.mutedBg, W.inkMuted));
    }

    const navBar = {
      type: 'FRAME',
      name: '顶栏导航区',
      layout: 'H',
      w: 'fill',
      h: 52,
      pad: [8, 16],
      fill: W.chromeBg,
      stroke: W.borderSoft,
      main: 'SPACE_BETWEEN',
      cross: 'CENTER',
      children: navChildren,
    };

    // 3) 主体滚动内容区（h: "fill" 贴合真实设备视口高度）
    const bodyElements = (sc.elements || []).map((el, eIdx) => buildScreenElement(el, eIdx, registerLink));
    const mainBody = {
      type: 'FRAME',
      name: '屏幕内容滚动区',
      layout: 'V',
      w: 'fill',
      h: 'fill',
      pad: 20,
      gap: 14,
      fill: W.screenBg,
      clip: true,
      children: bodyElements.length
        ? bodyElements
        : [txt('待添加本屏线稿控件', { size: 13, color: W.inkMuted })],
    };

    // 4) 底部轻量状态说明条
    const footerBar = {
      type: 'FRAME',
      name: '底部状态栏',
      layout: 'H',
      w: 'fill',
      h: 38,
      pad: [8, 16],
      fill: W.chromeBg,
      stroke: W.borderSoft,
      main: 'SPACE_BETWEEN',
      cross: 'CENTER',
      children: [
        txt(sc.footer_note || `状态：${sc.state || '默认态'}`, { size: 11, color: W.inkMuted, w: null }),
        txt(`Screen ${String(idx + 1).padStart(2, '0')}/${String(screens.length).padStart(2, '0')}`, { size: 11, weight: 600, color: W.inkMuted, w: null }),
      ],
    };

    // 顶层设备屏幕 Frame（Figma Prototype NAVIGATE 必须指向顶层 Frame！）
    screenFrames.push({
      type: 'FRAME',
      name: screenFrameName,
      layout: 'V',
      x: colX,
      y: screenTopY,
      w: screenW,
      h: screenH,
      radius: isDesktop ? 12 : 24,
      fill: W.screenBg,
      stroke: W.screenBorder,
      strokeWeight: 1.5,
      clip: true,
      children: [
        ...(statusBar ? [statusBar] : []),
        navBar,
        mainBody,
        footerBar,
      ],
    });

    // 5) 屏外正下方配套「PRD 映射与设计理由说明卡」（独立顶层兄弟节点，不污染 ▶ 原型预览视口！）
    const prdRefs = Array.isArray(sc.prd_refs) && sc.prd_refs.length
      ? sc.prd_refs
      : ['待关联对应 PRD 目标、流程步骤或验收编号'];
    const rationales = Array.isArray(sc.design_rationale)
      ? sc.design_rationale
      : (sc.design_rationale ? [String(sc.design_rationale)] : ['待补充本屏设计决策理由']);

    noteFrames.push({
      type: 'FRAME',
      name: `PRD映射与设计说明 · ${screenFrameName}`,
      layout: 'V',
      x: colX,
      y: noteTopY,
      w: screenW,
      h: 'hug',
      pad: 18,
      gap: 12,
      radius: 14,
      fill: W.noteCardBg,
      stroke: W.border,
      children: [
        {
          type: 'FRAME',
          name: '说明卡标题行',
          layout: 'H',
          w: 'fill',
          h: 'hug',
          main: 'SPACE_BETWEEN',
          cross: 'CENTER',
          fill: null,
          children: [
            tag(`↑ 对应屏幕 ${String(idx + 1).padStart(2, '0')}`, W.hotspotSoft, W.hotspotStroke),
            tag('屏外批注 · 不进入预览视口', W.mutedBg, W.inkMuted),
          ],
        },
        {
          type: 'FRAME',
          name: '对应 PRD 依据组',
          layout: 'V',
          w: 'fill',
          h: 'hug',
          pad: 12,
          gap: 6,
          radius: 8,
          fill: W.chromeBg,
          children: [
            txt('对应需求 PRD 依据', { size: 12, weight: 700, color: W.ink }),
            ...prdRefs.map((ref) => txt(`• ${ref}`, { size: 12, color: W.inkSec, lineHeight: 18 })),
          ],
        },
        {
          type: 'FRAME',
          name: '为什么这么设计组',
          layout: 'V',
          w: 'fill',
          h: 'hug',
          pad: 12,
          gap: 6,
          radius: 8,
          fill: W.activeBg,
          stroke: '#99F6E4',
          children: [
            txt('为什么这么设计（设计考量）', { size: 12, weight: 700, color: W.activeText }),
            ...rationales.map((why) => txt(`• ${why}`, { size: 12, color: W.inkSec, lineHeight: 18 })),
          ],
        },
        {
          type: 'FRAME',
          name: '本屏点击跳转清单',
          layout: 'V',
          w: 'fill',
          h: 'hug',
          pad: 12,
          gap: 5,
          radius: 8,
          fill: W.hotspotSoft,
          children: [
            txt('本屏可点击预览热区（ON_CLICK）', { size: 12, weight: 700, color: W.hotspotStroke }),
            ...(perScreenJumpDocs.length
              ? perScreenJumpDocs.map((j) => txt(`↗ ${j}`, { size: 11, color: W.inkSec, lineHeight: 17 }))
              : [txt('（本屏未设置外跳热区）', { size: 11, color: W.inkMuted })]),
          ],
        },
      ],
    });
  });

  const totalRowWidth = Math.max(960, screens.length * screenW + Math.max(0, screens.length - 1) * colGap);
  const entryTarget = nameMap.get(proto.entry_screen) || screens[0]?.name || null;

  const overviewBanner = {
    type: 'FRAME',
    name: `00 原型总览与预览指南 · ${proto.title || '可交互原型'}`,
    layout: 'V',
    x: 0,
    y: 0,
    w: totalRowWidth,
    h: 'hug',
    pad: [26, 32],
    gap: 12,
    radius: 16,
    fill: W.headerBg,
    children: [
      {
        type: 'FRAME',
        name: '原型元信息栏',
        layout: 'H',
        wrap: true,
        w: 'fill',
        h: 'hug',
        gap: 10,
        fill: null,
        children: [
          tag('可交互线稿原型（支持 Figma 点击预览）', '#38BDF8', '#0F172A', { size: 12, pad: [5, 10] }),
          ...(proto.prd_ref?.title ? [tag(`对应 PRD：${proto.prd_ref.title} (${proto.prd_ref.version || 'v1.0'})`, '#334155', '#F8FAFC', { size: 12, pad: [5, 10] })] : []),
          tag(`共 ${screens.length} 屏 · ${allLinks.length} 条点击跳转`, '#334155', '#F8FAFC', { size: 12, pad: [5, 10] }),
          ...(entryTarget ? [tag(`▶ 预览入口：${entryTarget}`, '#10B981', '#0F172A', { size: 12, pad: [5, 10] })] : []),
        ],
      },
      txt(proto.title || '产品可交互线稿原型', { size: 26, weight: 700, color: '#FFFFFF' }),
      txt(
        '预览方法：在 Figma 画布左上角点击首屏的蓝色「▶ 播放标」（或右上角 Present），即可直接点击带「↗」标记的按钮、列表项或顶栏完成全流程跳转体验；每屏正下方卡片说明该屏对应的 PRD 条款与设计理由。',
        { size: 13, color: W.headerSub, lineHeight: 20 },
      ),
    ],
  };

  const spec = {
    frames: [overviewBanner, ...screenFrames, ...noteFrames],
    links: allLinks,
  };
  if (entryTarget) {
    spec.flowStart = {
      frameName: entryTarget,
      name: proto.flow_name || '主流程预览',
    };
  }
  return spec;
}

export function renderPrototypeGuideMarkdown(proto, spec) {
  const lines = [
    `# ${proto.title || '可交互线稿原型说明'}`,
    '',
    `- **关联 PRD**：${proto.prd_ref?.title || '未绑定'}（${proto.prd_ref?.version || '—'}）`,
    `- **设备视口**：\`${proto.surface || 'mobile'}\`（共 ${proto.screens?.length || 0} 屏，已绑定 ${spec.links?.length || 0} 条 Figma 点击跳转）`,
    `- **Figma 预览起点**：\`${spec.flowStart?.frameName || '首屏'}\`（流程名：\`${spec.flowStart?.name || '主流程预览'}\`）`,
    '',
    '## 各屏幕与 PRD 对应关系及设计说明',
    '',
  ];

  (proto.screens || []).forEach((sc, idx) => {
    lines.push(`### ${idx + 1}. ${sc.name}（${sc.state || '默认态'}）`);
    lines.push('- **对应 PRD 部分**：');
    for (const r of sc.prd_refs || []) lines.push(`  - ${r}`);
    lines.push('- **为什么这么设计**：');
    const whys = Array.isArray(sc.design_rationale) ? sc.design_rationale : [sc.design_rationale].filter(Boolean);
    for (const w of whys) lines.push(`  - ${w}`);
    const jumps = (spec.links || []).filter((l) => l.fromWithin === sc.name);
    lines.push('- **Figma 点击跳转**：');
    if (jumps.length) {
      for (const j of jumps) lines.push(`  - \`${j.fromName}\` --(${j.trigger} / ${j.transition})--> \`${j.toName}\``);
    } else {
      lines.push('  - （无外跳）');
    }
    lines.push('');
  });
  return `${lines.join('\n').trim()}\n`;
}

export function exportPrototypeBundle(sourceJsonPath, outDir) {
  const absSource = path.resolve(sourceJsonPath);
  const absOut = path.resolve(outDir);
  const raw = JSON.parse(fs.readFileSync(absSource, 'utf8'));
  const menuState = computePrototypeMenuState(raw);
  const figmaSpec = buildPrototypeFigmaSpec(raw);
  const guideMd = renderPrototypeGuideMarkdown(raw, figmaSpec);

  fs.mkdirSync(absOut, { recursive: true });
  const figmaPath = path.join(absOut, 'Prototype.figma.json');
  const guidePath = path.join(absOut, 'Prototype-Guide.md');
  fs.writeFileSync(figmaPath, `${JSON.stringify(figmaSpec, null, 2)}\n`, 'utf8');
  fs.writeFileSync(guidePath, guideMd, 'utf8');

  return {
    ok: true,
    title: raw.title || '可交互线稿原型',
    figma_spec: figmaPath,
    guide_markdown: guidePath,
    flow_start: figmaSpec.flowStart || null,
    stats: {
      screens: (raw.screens || []).length,
      annotation_cards: (raw.screens || []).length,
      links: (figmaSpec.links || []).length,
      broken_links: menuState.broken_links,
    },
    menu_state: menuState,
  };
}
