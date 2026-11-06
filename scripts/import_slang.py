#!/usr/bin/env python3
"""Import virtual-goods slang from two MIT-licensed open dictionaries into assets/slang-terms.json.

Sources (clone them first; pass the checkout paths):
  https://github.com/Domainsun/awesome-chinese-secondhand-slang  data/slang-dictionary.json
  https://github.com/memos-im/xianyu-slang-helper                  data/dictionary.source.json

Only virtual-goods categories and a whitelist of generic trading phrases are imported.
HARD policy topics (adult services, drugs, weapons, gambling, account theft or money
laundering, minors) are dropped entirely; GREY topics are kept and marked policy=grey.
Variants that would misfire in free text (single characters, 1-3 ASCII alphanumerics)
are dropped. Re-run any time: python3 scripts/import_slang.py --awesome <dir> --helper <dir>
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'slang-terms.json'

AWESOME_CATEGORIES = {
    'ai-services': 'AI 服务', 'virtual-resources': '虚拟资源', 'digital-assets': '数字资产与会员拼车',
    'game-accounts': '游戏账号', 'academic-services': '学术代写', 'network-tools': '网络工具',
    'social-traffic': '社交流量', 'traffic-growth': '涨粉引流', 'xiaohongshu-matrix': '小红书矩阵',
    'ticket-voucher': '票券卡密',
    'condition-slang': '成色话术', 'evasion-contact': '站外引流', 'trading-terms': '交易话术', 'general-slang': '通用话术',
}
AWESOME_TALK = {'condition-slang', 'evasion-contact', 'trading-terms', 'general-slang'}
# Generic phrases from the talk categories that also apply to virtual goods; everything else there is physical-only.
AWESOME_TALK_WHITELIST = ('不退不换', '站外私聊', '小刀', '到手刀', '验货宝', '退坑回血', '拍下调价')
HELPER_CATEGORIES = {'games', 'ai-services', 'internet', 'virtual-goods', 'account-trade',
                     'transaction', 'off-platform', 'task-fraud', 'marketing', 'non-goods'}

# Ported from xianyu-slang-helper tools/lib/dict-shared.ts (MIT).
POLICY_HARD = [
    ('色情/特殊服务', re.compile(r'色情|约炮|约啪|裸聊|援交|楼凤|小姐|性服务|一夜情|上门服务|特殊服务|可骑|骑\s*\d|贴身衣物|私密物品|原味|穿过的|esc(?:ort)?|啪啪', re.I)),
    ('毒品/管制药', re.compile(r'大麻|可卡因|冰毒|摇头丸|迷药|listen水|听话水|笑气|飞叶子|嗑药|kush|weed|\bmdma\b|\blsd\b|特殊货|外烟特殊', re.I)),
    ('武器弹药', re.compile(r'枪支|手枪|步枪|弹药|子弹|管制刀具|甩棍|电棍|弩箭|爆炸物', re.I)),
    ('赌博', re.compile(r'赌博|博彩|私彩|六合彩|外围盘|时时彩', re.I)),
    ('盗号/洗钱/黑产', re.compile(r'盗号|社工库|黑客服务|四件套|洗钱|发卡网|秒u|跑分', re.I)),
    ('涉未成年', re.compile(r'未成年|萝莉|幼\s*女|稚嫩|硬币年份|\d{2}年硬币|年份硬币', re.I)),
]
POLICY_GREY = [
    ('假货/仿品', re.compile(r'高仿|仿冒|复刻|精仿|超A|A货|莆田|莞顶|原单|尾单|厂货|公司级|纯原|打板|裁片|过验|渠道货|老鼠货|流出', re.I)),
    ('违禁品/医疗减肥', re.compile(r'社保|公积金|挂靠|代缴|断缴|补缴|活体|领养|星期宠|减肥|掉称|甩肉|轻态生活|身材管理|处方药', re.I)),
    ('黑产工具/批量养号', re.compile(r'引流|矩阵|养号|协议号|云控|群控|批量去重|去水印|涨粉|刷单|代练|引流脚本|外挂|辅助器|破解器', re.I)),
    ('黄牛/代抢实名', re.compile(r'黄牛|代抢|实名录入|内场邀请函', re.I)),
]
COMMON_WORDS = {'米', '劳', '咽', '出', '收', '包', '刀', '可', '号', '车', '卡', '号', '书', '本'}


# Standard names whose variants trip a GREY regex by coincidence (e.g. '程序员外挂' is a joke, not cheat software).
POLICY_OVERRIDE_NONE = ('OpenAI Codex / GitHub Copilot / Cursor AI 编程助手',)


def classify(tokens):
    for label, rx in POLICY_HARD:
        if any(rx.search(t) for t in tokens):
            return 'hard', label
    for label, rx in POLICY_GREY:
        if any(rx.search(t) for t in tokens):
            return 'grey', label
    return '', ''


def risky_variant(v):
    s = str(v or '').strip()
    if not s or len(s) == 1:
        return True
    if re.fullmatch(r'[A-Za-z0-9]{1,3}', s):
        return True
    return s in COMMON_WORDS


def clean_variants(values):
    out, seen = [], set()
    for v in values:
        s = str(v or '').strip()
        if not s or risky_variant(s) or s.lower() in seen:
            continue
        seen.add(s.lower())
        out.append(s)
    return out


def import_awesome(path):
    entries = json.loads(Path(path).read_text(encoding='utf-8'))
    terms, dropped = [], []
    for e in entries:
        cat = e.get('category') or ''
        if cat not in AWESOME_CATEGORIES:
            continue
        name = str(e.get('standardName') or '').strip()
        if cat in AWESOME_TALK and not any(k in name for k in AWESOME_TALK_WHITELIST):
            continue
        variants = clean_variants(e.get('slangVariants') or [])
        level, label = classify([name, *variants])
        if name in POLICY_OVERRIDE_NONE:
            level, label = '', ''
        if level == 'hard':
            dropped.append((name, label))
            continue
        if not variants:
            continue
        terms.append(dict(
            name=name, variants=variants, category=cat, category_name=AWESOME_CATEGORIES[cat],
            liveness=e.get('liveness') or '', risk=e.get('riskLevel') or '',
            explanation=(e.get('explanation') or '').strip(), seller_intent=(e.get('sellerIntent') or '').strip(),
            successors=clean_variants(e.get('successorSlang') or []), trend=(e.get('activeTrend') or '').strip(),
            platforms=list(e.get('platforms') or []), policy=level, policy_label=label, source='awesome'))
    return terms, dropped


def import_helper(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    terms, dropped = [], []
    for cat in data.get('categories', []):
        if cat.get('id') not in HELPER_CATEGORIES:
            continue
        for name, variants in (cat.get('entries') or {}).items():
            variants = clean_variants(variants or [])
            level, label = classify([name, *variants])
            if name in POLICY_OVERRIDE_NONE:
                level, label = '', ''
            if level == 'hard':
                dropped.append((name, label))
                continue
            if not variants:
                continue
            terms.append(dict(
                name=str(name).strip(), variants=variants, category=cat['id'], category_name=cat.get('name', cat['id']),
                liveness='', risk='', explanation='', seller_intent='', successors=[], trend='',
                platforms=[], policy=level, policy_label=label, source='helper'))
    return terms, dropped


def build(awesome, helper):
    a_terms, a_drop = import_awesome(awesome)
    h_terms, h_drop = import_helper(helper)
    terms = a_terms + h_terms
    # Variants already covered by an awesome entry are removed from helper entries to avoid double hits.
    covered = {v.lower() for t in a_terms for v in t['variants']}
    kept = []
    for t in terms:
        if t['source'] == 'helper':
            t['variants'] = [v for v in t['variants'] if v.lower() not in covered]
            if not t['variants']:
                continue
        kept.append(t)
    for i, t in enumerate(kept, 1):
        t['id'] = f'S{i:04d}'
        t = dict(id=t.pop('id'), **t)
        kept[i - 1] = t
    return dict(
        version=dt.date.today().isoformat(),
        notice='暗语词条仅用于识别标题中的平台拦截词与绕审核写法，不构成对任何商品的合法性判断；高危题材不提供替代词。',
        sources=[
            dict(repo='Domainsun/awesome-chinese-secondhand-slang', license='MIT', scope='仅虚拟商品分类与通用交易话术'),
            dict(repo='memos-im/xianyu-slang-helper', license='MIT', scope='仅虚拟商品与交易话术分类，不含社区补充'),
        ],
        policy='HARD 档（色情服务、毒品、武器、赌博、盗号洗钱、涉未成年）整条剔除；GREY 档保留并标 policy=grey。',
        counts=dict(terms=len(kept), variants=sum(len(t['variants']) for t in kept),
                    dropped_hard=len(a_drop) + len(h_drop)),
        terms=kept,
    ), a_drop + h_drop


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--awesome', required=True, help='awesome-chinese-secondhand-slang checkout or its data JSON')
    parser.add_argument('--helper', required=True, help='xianyu-slang-helper checkout or its data/dictionary.source.json')
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args(argv)
    awesome = Path(args.awesome)
    helper = Path(args.helper)
    if awesome.is_dir():
        awesome = awesome / 'data' / 'slang-dictionary.json'
    if helper.is_dir():
        helper = helper / 'data' / 'dictionary.source.json'
    data, dropped = build(awesome, helper)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f"wrote {args.output.name}: {data['counts']['terms']} terms, {data['counts']['variants']} variants, dropped HARD {len(dropped)}")
    for name, label in dropped:
        print(f'  dropped [{label}] {name}')


if __name__ == '__main__':
    main()
