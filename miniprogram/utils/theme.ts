export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeSnapshot {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  themeVars: Record<string, string>
}

export const THEME_MODE_STORAGE_KEY = 'themeMode'
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

const subscribers = new Set<(snapshot: ThemeSnapshot) => void>()
let cachedMode: ThemeMode | null = null
let cachedSystemTheme: ResolvedTheme | null = null
let systemThemeListenerRegistered = false

type ThemePalette = {
  black: string
  white: string
  gray1: string
  gray2: string
  gray3: string
  gray4: string
  gray5: string
  gray6: string
  gray7: string
  gray8: string
  blue: string
  green: string
  purple: string
  text1: string
  text2: string
  text3: string
  text4: string
  link: string
  background: string
  background2: string
  background3: string
  headerBackground: string
  border: string
  code: string
  codeComment: string
  codeBackground: string
  blockquote: string
  blockquoteBackground: string
  active: string
  disabled: string
  danger: string
  warningBackground: string
  warningBorder: string
  warningText: string
  tabbarShadow: string
}

const LIGHT_PALETTE: ThemePalette = {
  black: '#000000',
  white: '#ffffff',
  gray1: '#f7f8fa',
  gray2: '#f2f3f5',
  gray3: '#ebedf0',
  gray4: '#dcdee0',
  gray5: '#c8c9cc',
  gray6: '#969799',
  gray7: '#646566',
  gray8: '#323233',
  blue: '#1989fa',
  green: '#07c160',
  purple: '#8e69d3',
  text1: '#111827',
  text2: '#323233',
  text3: '#34495e',
  text4: '#969799',
  link: '#1989fa',
  background: '#eff2f5',
  background2: '#ffffff',
  background3: '#ffffff',
  headerBackground: '#011f3c',
  border: '#ebedf0',
  code: '#58727e',
  codeComment: '#969799',
  codeBackground: '#f7f8fa',
  blockquote: '#2f85da',
  blockquoteBackground: '#ecf9ff',
  active: '#f2f3f5',
  disabled: '#c8c9cc',
  danger: '#ee0a24',
  warningBackground: '#fff7e6',
  warningBorder: '#ffd666',
  warningText: '#ad6800',
  tabbarShadow: '0 -2px 12px rgba(0, 0, 0, 0.06)',
}

const DARK_PALETTE: ThemePalette = {
  black: '#000000',
  white: '#ffffff',
  gray1: '#202124',
  gray2: '#2a2b2d',
  gray3: '#303134',
  gray4: '#3c4043',
  gray5: '#5f6368',
  gray6: '#9aa0a6',
  gray7: '#bdc1c6',
  gray8: '#e8eaed',
  blue: '#66b3ff',
  green: '#5dd39e',
  purple: '#b99bea',
  text1: '#f5f5f5',
  text2: '#e8eaed',
  text3: '#c5c9d1',
  text4: '#9aa0a6',
  link: '#66b3ff',
  background: '#121212',
  background2: '#1e1f21',
  background3: '#292a2d',
  headerBackground: '#1b2b3a',
  border: '#3a3b3e',
  code: '#b9d7e5',
  codeComment: '#9aa0a6',
  codeBackground: '#202124',
  blockquote: '#9bd6ff',
  blockquoteBackground: '#13344b',
  active: '#303134',
  disabled: '#777b80',
  danger: '#ff6b7a',
  warningBackground: '#3a2d16',
  warningBorder: '#7a5a23',
  warningText: '#ffd666',
  tabbarShadow: '0 -2px 12px rgba(0, 0, 0, 0.38)',
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function normalizeResolvedTheme(value: unknown): ResolvedTheme | null {
  if (value === 'dark' || value === 'light') {
    return value
  }
  return null
}

function readSystemTheme(): ResolvedTheme {
  if (typeof wx === 'undefined') {
    return 'light'
  }
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const systemInfo = wx.getSystemInfoSync()
      const systemTheme = normalizeResolvedTheme(systemInfo && systemInfo.theme)
      if (systemTheme) {
        return systemTheme
      }
    }
  } catch (error) {
    console.warn('读取系统主题失败，将使用浅色模式', error)
  }

  return 'light'
}

function getSystemTheme(): ResolvedTheme {
  if (!cachedSystemTheme) {
    cachedSystemTheme = readSystemTheme()
  }
  return cachedSystemTheme
}

function readThemeMode(): ThemeMode {
  if (typeof wx === 'undefined') {
    return DEFAULT_THEME_MODE
  }
  try {
    const stored = wx.getStorageSync(THEME_MODE_STORAGE_KEY)
    if (isThemeMode(stored)) {
      return stored
    }
  } catch (error) {
    console.warn('读取显示模式失败，将使用跟随系统', error)
  }
  return DEFAULT_THEME_MODE
}

export function getThemeMode(): ThemeMode {
  if (!cachedMode) {
    cachedMode = readThemeMode()
  }
  return cachedMode
}

function buildThemeVars(palette: ThemePalette): Record<string, string> {
  return {
    // These variables are used by the app and page styles. The hyphenated keys
    // intentionally preserve the existing --van-doc-text-color-1 names.
    vanDocBlack: palette.black,
    vanDocWhite: palette.white,
    'vanDocGray-1': palette.gray1,
    'vanDocGray-2': palette.gray2,
    'vanDocGray-3': palette.gray3,
    'vanDocGray-4': palette.gray4,
    'vanDocGray-5': palette.gray5,
    'vanDocGray-6': palette.gray6,
    'vanDocGray-7': palette.gray7,
    'vanDocGray-8': palette.gray8,
    vanDocBlue: palette.blue,
    vanDocGreen: palette.green,
    vanDocPurple: palette.purple,
    'vanDocTextColor-1': palette.text1,
    'vanDocTextColor-2': palette.text2,
    'vanDocTextColor-3': palette.text3,
    'vanDocTextColor-4': palette.text4,
    vanDocLinkColor: palette.link,
    vanDocBackground: palette.background,
    'vanDocBackground-2': palette.background2,
    'vanDocBackground-3': palette.background3,
    vanDocHeaderBackground: palette.headerBackground,
    vanDocBorderColor: palette.border,
    vanDocCodeColor: palette.code,
    vanDocCodeCommentColor: palette.codeComment,
    vanDocCodeBackground: palette.codeBackground,
    vanDocBlockquoteColor: palette.blockquote,
    vanDocBlockquoteBackground: palette.blockquoteBackground,
    vanDocDangerColor: palette.danger,
    vanDocWarningBackground: palette.warningBackground,
    vanDocWarningBorder: palette.warningBorder,
    vanDocWarningText: palette.warningText,
    tabbarBoxShadow: palette.tabbarShadow,

    cellBackgroundColor: palette.background2,
    cellTextColor: palette.text2,
    cellLabelColor: palette.text4,
    cellValueColor: palette.text4,
    cellRightIconColor: palette.text4,
    cellActiveColor: palette.active,
    cellGroupTitleColor: palette.text4,
    cellRequiredColor: palette.danger,
    navBarBackgroundColor: palette.background2,
    navBarTitleTextColor: palette.text1,
    navBarTextColor: palette.blue,
    navBarIconColor: palette.blue,
    popupBackgroundColor: palette.background2,
    dialogBackgroundColor: palette.background2,
    dialogHasTitleMessageTextColor: palette.text2,
    fieldInputTextColor: palette.text2,
    fieldInputDisabledTextColor: palette.disabled,
    fieldLabelColor: palette.text4,
    fieldPlaceholderTextColor: palette.text4,
    fieldClearIconColor: palette.text4,
    fieldIconContainerColor: palette.text4,
    fieldInputErrorTextColor: palette.danger,
    radioLabelColor: palette.text2,
    radioBorderColor: palette.border,
    radioCheckedIconColor: palette.blue,
    radioDisabledBackgroundColor: palette.background3,
    radioDisabledLabelColor: palette.disabled,
    buttonDefaultBackgroundColor: palette.background2,
    buttonDefaultBorderColor: palette.border,
    buttonDefaultColor: palette.text2,
    buttonInfoBackgroundColor: palette.blue,
    buttonInfoBorderColor: palette.blue,
    buttonInfoColor: palette.white,
    buttonPlainBackgroundColor: 'transparent',
    buttonDangerBackgroundColor: palette.danger,
    buttonDangerBorderColor: palette.danger,
    buttonDangerColor: palette.white,
    tabbarBackgroundColor: palette.background2,
    tabbarItemTextColor: palette.text4,
    tabbarItemActiveColor: palette.blue,
    tabsNavBackgroundColor: palette.background2,
    tabsBottomBarColor: palette.blue,
    tabsDefaultColor: palette.blue,
    tabTextColor: palette.text2,
    tabActiveTextColor: palette.blue,
    tabDisabledTextColor: palette.disabled,
    stepperBackgroundColor: palette.background2,
    stepperButtonIconColor: palette.blue,
    stepperButtonDisabledColor: palette.disabled,
    stepperInputTextColor: palette.text2,
    stepperInputDisabledBackgroundColor: palette.background3,
    uploaderFileBackgroundColor: palette.background3,
    uploaderFileNameTextColor: palette.text4,
    toastTextColor: palette.white,
    notifyPrimaryBackgroundColor: palette.blue,
    notifySuccessBackgroundColor: palette.green,
    notifyDangerBackgroundColor: palette.danger,
    overlayBackgroundColor: 'rgba(0, 0, 0, 0.7)',
  }
}

export function getThemeSnapshot(): ThemeSnapshot {
  const mode = getThemeMode()
  const resolvedTheme = mode === 'system' ? getSystemTheme() : mode
  const palette = resolvedTheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
  return {
    mode,
    resolvedTheme,
    themeVars: buildThemeVars(palette),
  }
}

function notifySubscribers(): void {
  const snapshot = getThemeSnapshot()
  subscribers.forEach((subscriber) => subscriber(snapshot))
}

function ensureSystemThemeListener(): void {
  if (
    systemThemeListenerRegistered ||
    typeof wx === 'undefined' ||
    typeof wx.onThemeChange !== 'function'
  ) {
    return
  }
  try {
    wx.onThemeChange((result) => {
      const nextTheme = normalizeResolvedTheme(result && result.theme)
      if (!nextTheme || nextTheme === cachedSystemTheme) {
        return
      }
      cachedSystemTheme = nextTheme
      notifySubscribers()
    })
    systemThemeListenerRegistered = true
  } catch (error) {
    console.warn('监听系统主题失败，主题将保持当前值', error)
  }
}

export function subscribeTheme(subscriber: (snapshot: ThemeSnapshot) => void): () => void {
  ensureSystemThemeListener()
  subscribers.add(subscriber)
  subscriber(getThemeSnapshot())
  return () => {
    subscribers.delete(subscriber)
  }
}

export function setThemeMode(mode: ThemeMode): void {
  if (!isThemeMode(mode)) {
    return
  }
  cachedMode = mode
  if (typeof wx !== 'undefined') {
    try {
      wx.setStorageSync(THEME_MODE_STORAGE_KEY, mode)
    } catch (error) {
      console.error('保存显示模式失败', error)
    }
  }
  notifySubscribers()
}
