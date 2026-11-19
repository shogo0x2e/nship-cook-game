import type { Event, ErrorEvent, StackFrame } from '@sentry/browser';

export const diagnosticMessages = {
  app_error: 'Unhandled application error', app_rejection: 'Unhandled application promise rejection',
  pose_initialization: 'CPU Lite pose model initialization failed', camera_start: 'Camera startup failed',
  pose_inference: 'CPU Lite pose inference failed', asset_load: 'Game artwork failed to load',
  tracking_unstable: 'Repeated pose instability (possible tracking issue)',
  tracking_lost: 'Sustained loss after tracking acquisition',
  tracking_stalled: 'Pose results stopped while the game was active',
  tracking_slow: 'Sustained slow CPU Lite inference', survey_delivery: 'Survey delivery failed',
} as const;
export type DiagnosticCode = keyof typeof diagnosticMessages;
export type DiagnosticContext = { experienceId?: string; deviceId?: string; screen?: string; demo?: boolean };
export type DiagnosticMetrics = Partial<Record<'samples'|'valid_samples'|'window_ms'|'jumps'|'toggles'|'inference_p50_ms'|'inference_p95_ms'|'interval_p50_ms'|'lost_ms'|'width'|'height'|'http_status', number>>;
export type DeviceDiagnosticContext = { browser: {name:string;version?:string}; os: {name:string;version?:string}; device: {model?:string;processor_count?:number;memory_size_gb?:number;screen_width?:number;screen_height?:number;touch?:boolean} };
export function diagnosticBrowser(ua:string):DeviceDiagnosticContext['browser'] {
  for(const [name,pattern] of [
    ['Edge',/(?:Edg|EdgA|EdgiOS)\/([\d.]+)/],['Samsung Internet',/SamsungBrowser\/([\d.]+)/],
    ['Opera',/OPR\/([\d.]+)/],['Firefox',/(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome',/(?:Chrome|CriOS)\/([\d.]+)/],['Safari',/Version\/([\d.]+).*Safari/],
  ] as const){const match=pattern.exec(ua);if(match)return {name,version:match[1]};}
  return {name:'Other'};
}
const metricKeys = ['samples','valid_samples','window_ms','jumps','toggles','inference_p50_ms','inference_p95_ms','interval_p50_ms','lost_ms','width','height','http_status'] as const;
const screens = new Set(['intro','camera','game','result','handoff','recipes','recipe','child-task','child-survey','parent-survey','done']);
export function cleanMetrics(value: DiagnosticMetrics): DiagnosticMetrics {
  return Object.fromEntries(metricKeys.flatMap(key => typeof value[key] === 'number' && Number.isFinite(value[key]) ? [[key, Math.round(Math.max(0, Math.min(1_000_000, value[key]!)))]] : []));
}
export function diagnosticErrorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (['TypeError','RangeError','ReferenceError','SyntaxError','NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError','NotSupportedError','InvalidStateError','AbortError','SecurityError'].includes(name)) return name;
  const message = error instanceof Error ? error.message : '';
  if (/out of memory|memory access|allocation failed/i.test(message)) return 'memory';
  if (/wasm|webassembly/i.test(message)) return 'wasm';
  if (/fetch|network|load/i.test(message)) return 'load';
  return 'Error';
}
function cleanFrame(frame: StackFrame, origin: string): StackFrame[] {
  try {
    const url = new URL(frame.filename ?? '', origin);
    if (url.origin !== origin || !/^\/(?:assets\/[\w.-]+\.js|camera-runtime\.js|src\/[\w./-]+\.ts|pose\/wasm\/[\w.-]+\.js)$/.test(url.pathname)) return [];
    return [{ filename: origin + url.pathname, function: /^[\w.$<> /-]{1,100}$/.test(frame.function ?? '') ? frame.function : undefined,
      lineno: frame.lineno, colno: frame.colno, in_app: true }];
  } catch { return []; }
}
// Rebuild the envelope event from an allowlist. No answers, free text, URLs with
// queries, cookies, authorization headers, DOM, raw landmarks or media survive.
export function sanitizeDiagnostic(event: Event, context: DiagnosticContext, device: DeviceDiagnosticContext, release: string, origin: string): ErrorEvent | null {
  const code = String(event.tags?.diagnostic_code) as DiagnosticCode;
  if (!Object.hasOwn(diagnosticMessages, code) || event.type) return null;
  const kind = String(event.tags?.error_kind ?? 'Error');
  const safeKind = /^[A-Za-z]{1,32}$/.test(kind) ? kind : 'Error';
  const frames = event.exception?.values?.flatMap(value => value.stacktrace?.frames?.flatMap(frame => cleanFrame(frame, origin)) ?? []).slice(-24);
  return {
    type: undefined, event_id: event.event_id, timestamp: event.timestamp, platform: 'javascript', logger: 'cookgame.diagnostics',
    level: code.startsWith('tracking_') ? 'warning' : 'error', message: diagnosticMessages[code],
    release, environment: context.demo ? 'demo' : 'production', fingerprint: ['cookgame', code, safeKind],
    tags: { diagnostic_code: code, error_kind: safeKind, pose_delegate: 'CPU', pose_model: 'Lite',
      ...(context.screen && screens.has(context.screen) ? {screen:context.screen} : {}),
      ...(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(context.experienceId ?? '') ? {experience_id:context.experienceId} : {}),
      ...(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(context.deviceId ?? '') ? {browser_id:context.deviceId} : {}),
    },
    contexts: { ...device, diagnostics: cleanMetrics((event.contexts?.diagnostics ?? {}) as DiagnosticMetrics) },
    ...(frames?.length ? {exception:{values:[{type:safeKind,value:diagnosticMessages[code],stacktrace:{frames}}]}} : {}),
  };
}
export class DiagnosticLimiter {
  private sent = new Set<string>();
  accept(code: DiagnosticCode, kind: string) {
    const key = `${code}:${kind}`;
    if (this.sent.has(key) || this.sent.size >= 12) return false;
    this.sent.add(key); return true;
  }
}
