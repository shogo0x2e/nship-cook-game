import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { mirroredTorsoX } from './game';
export type Tracking = { x: number | null; points: { x: number; y: number; visibility?: number }[]; inferenceMs: number; capturedAt: number; width: number; height: number };
export interface CameraSource { start(video: HTMLVideoElement): Promise<void>; stop(): void }
export class PoseCamera {
  private model?: PoseLandmarker;
  private stream?: MediaStream;
  private frame = 0;
  private generation = 0;
  private lastInference = -Infinity;
  private lastVideoTime = -1;
  private callback: (value: Tracking) => void;
  constructor(callback: (value: Tracking) => void) { this.callback = callback; }
  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    const generation = this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('HTTPS または localhost で開いてください。カメラのない場合はおためし操作で遊べます。');
    // Only local assets are used. No camera frames leave this device.
    const fileset = await FilesetResolver.forVisionTasks('/pose/wasm');
    const model = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/pose/pose_landmarker_lite.task', delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .6,
      minPosePresenceConfidence: .6, minTrackingConfidence: .6, outputSegmentationMasks: false,
    });
    if (generation !== this.generation) { model.close(); return; }
    this.model = model;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream; video.srcObject = stream;
    await video.play();
    if (generation !== this.generation) return;
    this.lastInference = -Infinity; this.lastVideoTime = -1;
    const tick = (now: number) => {
      if (generation !== this.generation) return;
      if (!document.hidden && video.readyState >= 2 && video.currentTime !== this.lastVideoTime && now - this.lastInference >= 30) {
        this.lastInference = now; this.lastVideoTime = video.currentTime;
        try {
          const started = performance.now();
          const result = model.detectForVideo(video, now);
          const points = result.landmarks[0] ?? [];
          this.callback({ x: mirroredTorsoX(points), points, inferenceMs: performance.now() - started, capturedAt: started, width: video.videoWidth, height: video.videoHeight });
        } catch { this.callback({ x: null, points: [], inferenceMs: 0, capturedAt: performance.now(), width: video.videoWidth, height: video.videoHeight }); }
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  stop(): void {
    this.generation++; cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined;
    this.model?.close(); this.model = undefined;
  }
}
