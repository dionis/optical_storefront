import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { fitFrameToFaceConvention, type FrameFitResult } from './frame_fitter';
import { measureFrame } from './frame_metrology';

export class SceneManager {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  
  // Group holding ONLY the glasses model (NO occluder — avoids scale contamination)
  public vtoGroup: THREE.Group;
  // Separate group in scene root — never scaled — holds head occluder
  private headGroup: THREE.Group;
  
  private currentModel: THREE.Object3D | null = null;
  private loader: GLTFLoader;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    
    // 1. Initialize Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.viewWidth, this.viewHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // 2. Initialize Scene & Camera
    this.scene = new THREE.Scene();
    
    this.camera = new THREE.PerspectiveCamera(50, this.viewWidth / this.viewHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    // The vertical fov above is a placeholder; what the scene keeps matched to the webcam
    // is the HORIZONTAL field, so derive the vertical one from it straight away.
    this.applyCameraFov();

    // 3. Set up Root Group (glasses only — NO occluder child here)
    this.vtoGroup = new THREE.Group();
    this.scene.add(this.vtoGroup);

    // 3b. Separate head group at scene root — scale always = (1,1,1)
    this.headGroup = new THREE.Group();
    this.scene.add(this.headGroup);

    // 4. Initialize GLTF Loader
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    // Decoder is served from our own origin, not gstatic. The generation pipeline Draco-
    // compresses every GLB, so without a reachable decoder the model fails to parse and
    // the VTO silently falls back to the procedural frame — which is exactly what happens
    // on a deployment with no outbound access to Google's CDN.
    dracoLoader.setDecoderPath('./draco/');
    this.loader.setDRACOLoader(dracoLoader);

    // 5. Setup Head Occluder and Lighting
    this.setupHeadOccluder();
    this.setupLighting();

    // 6. Handle Window Resizing
    const onResize = this.onWindowResize.bind(this);
    window.addEventListener('resize', onResize);
    // Phones change the viewport without a window resize: rotation, and the browser
    // chrome sliding in and out as the page is scrolled.
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
  }

  /**
   * Live CSS size of the canvas. Read from layout rather than from window.innerWidth:
   * on mobile the two disagree while the URL bar animates, and a canvas sized to the
   * wrong box stretches the frame off the face.
   */
  private get viewWidth(): number {
    return this.canvas.clientWidth || window.innerWidth;
  }

  private get viewHeight(): number {
    return this.canvas.clientHeight || window.innerHeight;
  }

  private headOccluderMesh: THREE.Mesh | null = null;

  /**
   * The stand-in head, in METRES. The group's scale is scene units per metre of real
   * frame, so every length here is a physical one — the same units the fitted model is in.
   *
   * WHAT THIS IS FOR. Nothing in the scene knows where the patient's head actually is; the
   * video is a flat backdrop painted behind the 3D frame. Without a body writing depth, the
   * temples — which run 150 mm back from the lens plane — are drawn straight over the face.
   * Perspective makes them converge toward the middle of the picture as they recede, so
   * they read as two dark wedges cutting across the eyes and stopping halfway, instead of
   * disappearing behind the head on their way to the ears.
   *
   * WHY THESE NUMBERS. An adult head is about 152 mm across the parietals, 190 mm from brow
   * to occiput. The centre sits 5 mm below the pupil line and 100 mm behind it, which puts
   * the front of the ellipsoid 5 mm BEHIND the pupil plane — a full 20 mm clear of the
   * frame's front plane, so the rims, bridge and lenses are never eaten.
   *
   * VERIFIED against the sample model over camera distances of 350-1000 mm and head poses
   * to 50 deg of yaw and 15 deg of pitch: 0.00% of the frame front is occluded at every
   * one, while 91% of the temple geometry is hidden. What stays visible is the stretch just
   * behind the end piece — which is exactly what a real frontal photograph shows — and
   * turning the head correctly brings the near temple back out past the silhouette.
   *
   * THE WIDTH IS THE SENSITIVE ONE, and it is set by where the temple has to stay visible
   * TO, not by how much of it can be hidden. This is the SKULL, and it is narrower than
   * the ear-to-ear measurement, because the ears stand proud of it — they are modelled
   * separately, as their own pucks below. Widening it buries the temple inside the head,
   * and the arm then dies against the cheek instead of arriving at the ear.
   *
   * Measured, with the frame at its dispensed tilt and the ear at -108 mm:
   *     138 mm -> temple drawn to -105 mm (-112 turned)   arrives at the ear
   *     144 mm -> -92 mm     short by 16 mm
   *     148 mm -> -80 mm     short by 28 mm
   * Below ~134 mm the skull stops covering the hook and a sliver pokes out past the ear.
   * Re-measure before changing it.
   */
  private static readonly HEAD_SEMI_AXES = { x: 0.069, y: 0.110, z: 0.095 };
  private static readonly HEAD_CENTRE_Y = -0.005;
  private static readonly HEAD_CENTRE_Z = -0.100;

  private setupHeadOccluder(): void {
    // Invisible head occluder (ellipsoid) standing in for the patient's skull
    const geometry = new THREE.SphereGeometry(1, 32, 24);
    const semi = SceneManager.HEAD_SEMI_AXES;
    geometry.scale(semi.x, semi.y, semi.z);

    const material = new THREE.MeshBasicMaterial({
      colorWrite: false, // Invisible (does not output pixels to canvas)
      depthWrite: true   // Writes depth buffer (occludes objects behind head)
    });

    this.headOccluderMesh = new THREE.Mesh(geometry, material);
    this.headOccluderMesh.position.set(
      0,
      SceneManager.HEAD_CENTRE_Y,
      SceneManager.HEAD_CENTRE_Z
    );
    this.headOccluderMesh.renderOrder = 0; // Render into depth buffer first

    this.headGroup.add(this.headOccluderMesh);
    this.setupEarOccluders(material);
  }

  private earOccluders: THREE.Mesh[] = [];

  /**
   * The ears, as two depth-only pucks.
   *
   * The skull ellipsoid has none, and an ear is the one part of a head that a temple
   * actually disappears BEHIND. Without them the arm is drawn straight over the ear it is
   * supposed to be tucking behind — the tip sitting on top of the patient's ear in the
   * picture, which is exactly backwards.
   *
   * They are placed with their FRONT pole on the temple's own rest point, so the arm stays
   * visible for its whole run up to the ear and is hidden from there back. Small enough
   * (28 x 64 x 44 mm) that they only ever cover the ear itself, and they live far behind
   * the lens plane, so they cannot touch the front of the frame.
   */
  private static readonly EAR_SEMI_AXES = { x: 0.014, y: 0.032, z: 0.022 };

  private setupEarOccluders(material: THREE.Material): void {
    const semi = SceneManager.EAR_SEMI_AXES;
    for (let i = 0; i < 2; i++) {
      const geometry = new THREE.SphereGeometry(1, 20, 16);
      geometry.scale(semi.x, semi.y, semi.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 0;
      mesh.visible = false; // until a real ear has been measured
      this.earOccluders.push(mesh);
      this.headGroup.add(mesh);
    }
  }

  /**
   * Positions the ear pucks from the patient's own measurements, or hides them when there
   * is nothing trustworthy to place them with — a wrongly placed one would eat the temple
   * it exists to finish.
   */
  public setEarOccluders(placement: { halfWidthM: number; yM: number; zM: number } | null): void {
    if (!placement || !(placement.halfWidthM > 0) || placement.zM > -0.06) {
      this.earOccluders.forEach((m) => (m.visible = false));
      return;
    }
    const back = placement.zM - SceneManager.EAR_SEMI_AXES.z;
    this.earOccluders.forEach((mesh, i) => {
      mesh.visible = true;
      mesh.position.set(i === 0 ? -placement.halfWidthM : placement.halfWidthM, placement.yM, back);
    });
  }

  /**
   * Places the head occluder on the face.
   *
   * `scale` is scene units per metre, WITHOUT the operator's frame-size slider folded in:
   * shrinking a frame to compare it against a wider one must not shrink the patient too,
   * or the temples of the smaller frame start poking through a head that shrank with them.
   * The group is kept outside vtoGroup for the same reason — the temple-width control
   * stretches the frame sideways and must not stretch the skull.
   *
   * `headWidthMM` is the patient's own measured width across the ears. Using it rather than
   * a nominal head is what makes a frame that is genuinely too wide LOOK too wide: its
   * temples stand off the sides of the head instead of being quietly swallowed.
   */
  public updateOccluder(
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    scale: number,
    headWidthMM?: number | null
  ): void {
    if (!this.headGroup) return;
    this.headGroup.position.copy(position);
    this.headGroup.quaternion.copy(quaternion);
    this.headGroup.scale.setScalar(scale > 0 ? scale : 1);

    if (this.headOccluderMesh) {
      const halfWidth = SceneManager.occluderHalfWidth(headWidthMM);
      this.headOccluderMesh.scale.x = halfWidth / SceneManager.HEAD_SEMI_AXES.x;
    }
  }

  /**
   * Half-width of the occluding ellipsoid, in metres, for a measured head.
   *
   * The measurement runs between the ear landmarks, so it spans the ears — and the ears
   * stand proud of the skull they are attached to. This is the skull alone, so it comes
   * out slightly UNDER the measurement; the ears themselves are the pucks below. Sizing
   * the skull to the full ear-to-ear figure is what left the temples buried inside it,
   * dying against the cheek instead of reaching the ear.
   * The band is a guard, not a preference: a momentarily bad measurement must not be able
   * to strip the head away or grow it over the lenses.
   */
  private static readonly HEAD_WIDTH_MARGIN = 0.97;
  private static readonly HEAD_WIDTH_BAND_MM = { min: 130, max: 150 };

  private static occluderHalfWidth(headWidthMM?: number | null): number {
    const semi = SceneManager.HEAD_SEMI_AXES;
    if (!headWidthMM || !isFinite(headWidthMM) || headWidthMM <= 0) return semi.x;

    const band = SceneManager.HEAD_WIDTH_BAND_MM;
    const widened = headWidthMM * SceneManager.HEAD_WIDTH_MARGIN;
    return Math.min(band.max, Math.max(band.min, widened)) / 2000;
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(1, 2, 3);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa5b4fc, 0.4);
    fillLight.position.set(-1, -1, 2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x00f0ff, 0.5);
    rimLight.position.set(0, 0, -5);
    this.scene.add(rimLight);
  }

  /**
   * Clears all eyewear models (both procedural fallback and custom GLBs) from vtoGroup.
   * Preserves ONLY the invisible head-occluder mesh.
   */
  public clearEyewearModels(): void {
    // vtoGroup no longer contains the occluder — clear ALL children safely
    const toRemove = [...this.vtoGroup.children];
    toRemove.forEach((child) => {
      this.vtoGroup.remove(child);
      this.disposeObject(child);
    });
    this.currentModel = null;
  }

  public getCurrentModel(): THREE.Object3D | null {
    return this.currentModel;
  }

  /**
   * Load eyewear GLB/glTF model from binary array buffer.
   * Does NOT modify the scene — caller is responsible for calling
   * clearEyewearModels() and installing the returned object.
   */
  public async loadEyewearModel(url: string): Promise<THREE.Object3D> {
    // Errors carry a `code` so the caller can tell "no model generated yet" (normal)
    // apart from a genuine fault (must be surfaced). String matching on the message is
    // not reliable: a dev server answers a missing file with 200 + an HTML page.
    const fail = (message: string, code: 'missing' | 'http' | 'parse') =>
      Object.assign(new Error(message), { code });

    const response = await fetch(url);
    if (!response.ok) {
      throw fail(
        `GLB not available (HTTP ${response.status})`,
        response.status === 404 ? 'missing' : 'http'
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      // The static server answered with its index page, i.e. the file is not there
      throw fail('GLB path returned an HTML page instead of a binary model', 'missing');
    }

    return this.parseEyewearBuffer(await response.arrayBuffer());
  }

  /**
   * Parses an in-memory GLB/GLTF buffer into a prepared eyewear model.
   *
   * Split out of loadEyewearModel so a file the operator picks from disk takes exactly
   * the same path as one fetched from the server — same material treatment, same Draco
   * decoder, same error reporting — without inventing a URL to fetch it back from.
   */
  public parseEyewearBuffer(arrayBuffer: ArrayBuffer): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      this.loader.parse(
        arrayBuffer,
        './models/',
        (gltf) => {
          const model = gltf.scene;
          model.name = "custom-eyewear-model";
          model.renderOrder = 1;
          this.applyPremiumMaterials(model);
          resolve(model);
        },
        (error: any) => {
          console.error("[SceneManager] Error parsing GLB model buffer:", error);
          const raw = error?.message || String(error);
          // Draco is the usual culprit: the generation pipeline compresses every GLB, so
          // an unreachable decoder shows up here and nowhere else.
          const hint = /draco/i.test(raw)
            ? `${raw} — the Draco decoder under ./draco/ could not be loaded`
            : raw;
          reject(Object.assign(new Error(hint), { code: 'parse' }));
        }
      );
    });
  }

  /**
   * Install a fully-prepared model into the scene (clears previous models first).
   *
   * Every frame goes through the fitter on the way in — the procedural fallback included —
   * so whatever pose, origin and unit the file arrived with, what ends up in vtoGroup is
   * always the same convention: front width equal to the SKU, horizontally centred on the
   * frame front, y = 0 on the pupil line, front plane a vertex distance ahead of it.
   * Scaling by the bounding box alone (what this used to do) left the other four degrees
   * of freedom to chance, which is why a model could load at the right size and still sit
   * beside the face rather than on it.
   */
  public installEyewearModel(model: THREE.Object3D, targetWidthMM?: number): FrameFitResult {
    this.clearEyewearModels();
    // The lens opening decides the vertical placement, so it is measured before the fit
    // rather than after: `pupilHeightRatio` is defined against the opening, not against
    // the front's bounding box. Both sides are averaged — a generated mesh is rarely
    // perfectly symmetric, and the frame has one height, not two.
    const metrology = measureFrame(model);
    const od = metrology.sides.od.aperture;
    const os = metrology.sides.os.aperture;
    const usable = [od, os].filter((a) => a.confidence === 'measured' && a.height > 0);
    const aperture = usable.length
      ? {
          bottomY: usable.reduce((s, a) => s + a.apertureBottomY, 0) / usable.length,
          height: usable.reduce((s, a) => s + a.height, 0) / usable.length,
        }
      : undefined;

    const fit = fitFrameToFaceConvention(model, { targetWidthMM, aperture });
    this.lastFit = fit;
    this.reportFit(model.name || 'frame', fit);
    this.currentModel = model;
    this.vtoGroup.add(model);
    return fit;
  }

  /** Outcome of the last fit, for the panel that tells the operator what was loaded. */
  public lastFit: FrameFitResult | null = null;

  private reportFit(label: string, fit: FrameFitResult): void {
    const dims =
      `${fit.frontWidthMM.toFixed(1)} x ${fit.frontHeightMM.toFixed(1)} x ` +
      `${fit.totalDepthMM.toFixed(1)} mm`;
    const rest = fit.earRestMM
      ? `ear rest y ${fit.earRestMM.y.toFixed(1)} z ${fit.earRestMM.z.toFixed(1)} mm`
      : 'ear rest NOT FOUND';
    const head =
      `[SceneManager] "${label}" fitted: ${dims} · ${fit.axisMapping} · ` +
      `scale ${fit.scaleFactor.toFixed(4)} · ${rest}` +
      `${fit.reoriented ? ' · reoriented' : ''}`;

    // A frame whose axes could not be read is still installed, but the operator has to be
    // told: it is the one case where the sliders are the only way to make it sit right.
    if (fit.confidence === 'assumed') {
      console.warn(`${head}\n  axes assumed — ${fit.notes.join('; ')}`);
    } else {
      console.log(head);
      fit.notes.forEach((n) => console.warn(`[SceneManager]   ${n}`));
    }
  }

  private applyPremiumMaterials(rootObject: THREE.Object3D): void {
    // Tortoise-shell acetate — used for any dark/untextured TRELLIS mesh
    const acetateMat = new THREE.MeshStandardMaterial({
      color: 0x5c3317, metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide,
    });

    rootObject.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.visible = true;
      node.renderOrder = 1;
      node.castShadow = true;

      const nameLower = node.name.toLowerCase();
      const mat = node.material as THREE.MeshStandardMaterial;

      // Check if material is dark/black (TRELLIS default)
      const col = mat && (mat as any).color;
      const isDark = col ? (col.r + col.g + col.b < 0.15) : false;
      const hasTexture = mat && (mat as any).map;

      if (nameLower.includes('lens') || nameLower.includes('cristal') || nameLower.includes('glass')) {
        node.material = new THREE.MeshPhysicalMaterial({
          color: 0x1e3a5f, roughness: 0.05, metalness: 0.0,
          transmission: 0.75, transparent: true, opacity: 0.55,
          clearcoat: 1.0, ior: 1.52, side: THREE.DoubleSide,
        });
      } else if (nameLower.includes('metal') || nameLower.includes('hinge') || nameLower.includes('gold')) {
        node.material = new THREE.MeshStandardMaterial({
          color: 0xc8a96e, metalness: 0.95, roughness: 0.1, side: THREE.DoubleSide,
        });
      } else if (isDark || (!hasTexture && mat)) {
        // Replace dark / untextured TRELLIS geometry with visible acetate
        node.material = acetateMat;
      } else {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(m => { m.side = THREE.DoubleSide; m.depthWrite = true; m.needsUpdate = true; });
      }
    });
  }

  /**
   * Horizontal field of view the virtual camera is set to reproduce, in degrees — the
   * field actually PAINTED on screen, after `object-fit: cover` has cropped the stream.
   *
   * This is the one number that controls how much the frame foreshortens. Nothing in the
   * plane of the lenses depends on it: the landmarks are mapped through the same
   * projection that sizes the frame, so the front lands on the eyes at any value. What it
   * does control is everything that runs back in depth — which in practice means the
   * temples. Left at the default 50 deg vertical, the implied horizontal field came out
   * near 80 deg on a 16:9 desktop and near 29 deg on a portrait phone, neither of which is
   * a webcam. Too wide and the temples converge too hard and land inside the ears; too
   * narrow and they splay outside the head.
   */
  private captureHFovDeg = 60;

  /**
   * Points the virtual camera at the same field of view the real one had, so the frame is
   * foreshortened exactly as the face in the video behind it was.
   *
   * The deadband is there because the measurement comes off a smoothed distance and drifts
   * by fractions of a degree; rebuilding the projection on that would make the whole scene
   * breathe in and out.
   */
  public setCaptureHorizontalFov(deg: number): void {
    if (!isFinite(deg) || deg <= 0) return;
    if (Math.abs(deg - this.captureHFovDeg) < 0.25) return;
    this.captureHFovDeg = deg;
    this.applyCameraFov();
  }

  /** Converts the horizontal field to the vertical one three.js wants, at this aspect. */
  private applyCameraFov(): void {
    const aspect = this.camera.aspect > 0 ? this.camera.aspect : 1;
    const halfH = (this.captureHFovDeg * Math.PI) / 360;
    this.camera.fov = (2 * Math.atan(Math.tan(halfH) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  private onWindowResize(): void {
    const w = this.viewWidth;
    const h = this.viewHeight;
    if (w <= 0 || h <= 0) return;

    this.camera.aspect = w / h;
    // Re-derive the vertical fov: the horizontal field is what has to stay matched to the
    // video, and it is the aspect that just changed.
    this.applyCameraFov();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // updateStyle = false: the canvas is sized by CSS (100% of #app), so writing inline
    // pixel dimensions here would freeze it at the size it had on the previous resize.
    this.renderer.setSize(w, h, false);
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public disposeObject(obj: THREE.Object3D): void {
    obj.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        if (node.name === "head-occluder") return;
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) {
            node.material.forEach((m) => m.dispose());
          } else {
            node.material.dispose();
          }
        }
      }
    });
  }
}
