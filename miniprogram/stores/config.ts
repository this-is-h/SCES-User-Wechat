/**
 * UnitConfig 唯一消费入口(架构 05 §3.2):页面与 store 不直接碰原始 JSON。
 * - resolveConfig(raw):纯函数,把 UnitConfig 展开成 wxml 友好的 ResolvedConfig(便于单测)。
 * - loadConfig(unitId):经 gateway 取当前批次的配置后再 resolveConfig。
 *
 * RenderItem 这层展开的意义:.wxml 里做 scoreType 判别联合的嵌套 wx:if 既慢又易错,
 * 一次性在 JS 侧摊平为三种平级 kind(stepper/radio/input),模板只需三个平级 wx:if。
 * 将来 schema 新增第四种 scoreType,只改这里 + 一个模板分支。
 */
import type {
  UnitConfig,
  StudentField,
  ClassCascader,
  DyfItem,
  DyfCategory,
  TakeHighestScope
} from '../shared/types/index'
import { gateway } from '../gateway/active'

/** 由 scoreType 判别联合摊平出的 wxml 友好描述。 */
export interface RenderItem {
  code: string
  description: string
  /** 'stepper' | 'radio' | 'input' —— wxml 用三个平级 wx:if。 */
  kind: 'stepper' | 'radio' | 'input'
  min?: number
  max?: number
  step?: number
  decimals?: number
  options?: Array<{ value: number; label: string }>
  needSupport: boolean
  supportMessage: string
  /** 有效必填 = 条目必填 || 所属分类必填。 */
  studentRequired: boolean
  allowAdd: boolean
  negative: boolean
  categoryCode: string
}

/** 学生端可申请项目树(按分类→组分节渲染,已过滤 studentApplicable 且丢弃空组/空类)。 */
export interface ApplicableCategory {
  /** 分类 code(= category.code,供 wx:for 的 wx:key)。 */
  code: string
  category: { code: string; name: string; studentRequired: boolean; penalty: boolean; takeHighest?: false | { scope: TakeHighestScope; prefixLength?: number } }
  groups: Array<{ code: string; name: string; takeHighest?: false | { scope: TakeHighestScope; prefixLength?: number }; items: RenderItem[] }>
}

export interface ResolvedConfig {
  raw: UnitConfig
  /** 学生端表单字段(顺序即渲染顺序),fromClass 字段由班级级联填充且只读。 */
  studentFields: StudentField[]
  /** 班级级联(直接取 raw.class)。 */
  classCascader: ClassCascader
  applicableTree: ApplicableCategory[]
  /** itemCode → RenderItem(仅含学生端可申请项),供导出/校验直取。 */
  itemIndex: Record<string, RenderItem>
  version: number
  revision: number
}

/** 单个 DyfItem → RenderItem(摊平 scoreType,合并分类级必填)。 */
function toRenderItem(item: DyfItem, category: DyfCategory): RenderItem {
  const st = item.scoreType
  const ri: RenderItem = {
    code: item.code,
    description: item.description,
    kind: st.type,
    needSupport: item.support.need,
    supportMessage: item.support.need ? item.support.message : '',
    studentRequired: item.studentRequired || category.studentRequired,
    allowAdd: item.allowAdd,
    negative: item.negative,
    categoryCode: category.code
  }
  if (st.type === 'stepper') {
    ri.min = typeof st.min === 'number' ? st.min : 0
    ri.max = typeof st.max === 'number' ? st.max : Number.MAX_SAFE_INTEGER
    ri.step = typeof st.step === 'number' ? st.step : 1
    ri.decimals = st.decimals
  } else if (st.type === 'radio') {
    ri.options = st.options.map((o) => ({ value: o.value, label: o.label }))
  } else {
    ri.min = st.min
    ri.max = st.max
    ri.decimals = st.decimals
  }
  return ri
}

/** 纯函数:UnitConfig → ResolvedConfig。不触碰 gateway / wx,便于单测。 */
export function resolveConfig(raw: UnitConfig): ResolvedConfig {
  const applicableTree: ApplicableCategory[] = []
  const itemIndex: Record<string, RenderItem> = {}
  for (const category of raw.dyf.categories) {
    const groups: Array<{ code: string; name: string; takeHighest?: false | { scope: TakeHighestScope; prefixLength?: number }; items: RenderItem[] }> = []
    for (const group of category.groups) {
      const items: RenderItem[] = []
      for (const item of group.items) {
        if (!item.studentApplicable) {
          continue
        }
        const ri = toRenderItem(item, category)
        items.push(ri)
        itemIndex[item.code] = ri
      }
      if (items.length > 0) {
        groups.push({ code: group.code, name: group.name, takeHighest: group.takeHighest, items })
      }
    }
    if (groups.length > 0) {
      applicableTree.push({
        code: category.code,
        category: {
          code: category.code,
          name: category.name,
          studentRequired: category.studentRequired,
          penalty: category.penalty,
          takeHighest: category.takeHighest
        },
        groups
      })
    }
  }
  return {
    raw,
    studentFields: raw.student,
    classCascader: raw.class,
    applicableTree,
    itemIndex,
    version: raw.version,
    revision: raw.revision
  }
}

/** 取最高分去重族 key(决策 #?):返回 null 表示该分类未启用 takeHighest(累加)。
 * 同一族内多个已填项只取最高分计入总分;族外项互不影响。
 */
export function familyKeyFor(
  category: { takeHighest?: false | { scope: TakeHighestScope; prefixLength?: number } } | undefined,
  group: { takeHighest?: false | { scope: TakeHighestScope; prefixLength?: number } } | undefined,
  opts: { categoryCode: string; groupCode: string; itemCode: string },
): string | null {
  const th = (category && category.takeHighest) || (group && group.takeHighest)
  if (!th) {
    return null
  }
  const scope = th.scope || 'prefix'
  if (scope === 'category') {
    return `cat:${opts.categoryCode}`
  }
  if (scope === 'group') {
    return `grp:${opts.categoryCode}/${opts.groupCode}`
  }
  const prefixLength = typeof th.prefixLength === 'number' && th.prefixLength > 0 ? th.prefixLength : 0
  return `pre:${opts.categoryCode}/${opts.itemCode.slice(0, prefixLength)}`
}

/** 经 gateway 取当前批次的配置并展开。找不到配置时抛错(由调用页兜底提示)。 */
export async function loadConfig(unitId: string): Promise<ResolvedConfig> {
  const active = await gateway.getActiveBatch(unitId)
  if (!active.config) {
    throw new Error('未找到该单位的配置,请确认单位选择是否正确')
  }
  return resolveConfig(active.config)
}
