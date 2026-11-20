// GA receives only these fixed screens and milestones, never experience IDs or answers.
export const analyticsOrigin = 'https://cookgame.shogo0x2e.com';
export const measurementId = 'G-1S85VPLYT6';
const screens = {
  intro: '体験の説明', camera: 'ゲームの準備', game: 'ゲーム', result: 'ゲーム結果',
  handoff: '保護者への受け渡し', recipes: 'レシピ候補', recipe: 'レシピの確認',
  'child-task': '子どものお手伝い', 'child-survey': '子どものアンケート',
  'parent-survey': '保護者のアンケート', concept: 'サービスの構想', budget: '機能と料金のアンケート', done: '回答完了',
} as const;
type Screen = keyof typeof screens;
type Params = Record<string, string | boolean>;
type Send = (event: string, parameters: Params) => void;

export function analyticsEnabled(href: string) {
  const url = new URL(href);
  return url.origin === analyticsOrigin && url.pathname === '/' && url.searchParams.get('demo') !== '1';
}

export function createFlowAnalytics(send: Send) {
  let current: Screen | undefined;
  const milestones = new Set<string>();
  const context = (screen: Screen): Params => ({
    screen_name: screen,
    page_title: `${screens[screen]}｜親子のごはんづくり`,
    page_location: `${analyticsOrigin}/${screen === 'intro' ? '' : `#${screen}`}`,
  });
  const milestone = (event: string) => {
    if (!current || milestones.has(event)) return;
    milestones.add(event);
    send(event, context(current));
  };
  return {
    screen(stage: string, step?: string) {
      const value = stage === 'parent-survey' && (step === 'concept' || step === 'budget') ? step : stage;
      if (!Object.hasOwn(screens, value) || current === value) return;
      current = value as Screen;
      send('page_view', context(current));
      if (current === 'recipes') send('recipe_list_view', context(current));
      if (current === 'recipe') send('recipe_view', context(current));
    },
    startGame() { milestone('game_start'); },
    completeSurvey() { milestone('survey_complete'); },
  };
}

export function initAnalytics() {
  let send: Send = () => {};
  if (analyticsEnabled(location.href)) {
    // Keep the queue shape expected by the official Google tag, without inline script.
    const target = window as Window & { dataLayer?: unknown[] };
    target.dataLayer ??= [];
    function gtag(..._args: unknown[]) { target.dataLayer!.push(arguments); }
    gtag('consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    // Apply before `js`: the managed Google tag can initialize a destination before our config.
    gtag('set', {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: analyticsOrigin + '/', page_referrer: '', page_title: `${screens.intro}｜親子のごはんづくり`,
    });
    gtag('js', new Date());
    gtag('config', measurementId, {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: analyticsOrigin + '/', page_referrer: '',
      page_title: `${screens.intro}｜親子のごはんづくり`, cookie_flags: 'SameSite=Lax;Secure',
    });
    send = (event, parameters) => gtag('event', event, { ...parameters, send_to: measurementId });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  }
  return createFlowAnalytics(send);
}
