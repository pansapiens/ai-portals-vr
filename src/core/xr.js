// WebXR (Meta Quest and other headsets). The flight is the same; only the drawing changes while a headset session runs.
// The engine still works out the camera along the route each frame. Here that pose becomes a rig: the route's position
// and its heading only (no pitch, no roll, the comfortable choice in a headset), and the head's own pose is added on top.
// Each eye is drawn into one float buffer laid out as the headset's own buffer is (side by side), and Post grades that
// buffer straight onto the headset's (no glow pass, no style lens: they cost too much on a headset's GPU). The next world
// is drawn once per eye too, so the opening has depth; the portal's shader is handed each eye's matrix before that eye.
// ponytail: feed worlds (portal.feed, one world) and the lens and nearThrough swing of Engine._renderPortal are not
// handled in a headset: feed worlds show the plain window, and a far opening is the exact (narrow) window.
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const _f = new THREE.Vector3(), _v = new THREE.Vector3(), _v4 = new THREE.Vector4(), _q = new THREE.Quaternion();
const _M = new THREE.Matrix4(), _C = new THREE.Matrix4(), _U = new THREE.Matrix4();
// the most of the headset's own resolution the picture is drawn at, by graphics level; the engine's governor lowers it (scale)
// while frames miss the headset's rate, and the next world in the portal is drawn at PORTAL_SCALE of that
const SCALE = { low: 0.6, medium: 0.75, high: 0.9, ultra: 1 }, MIN_SCALE = 0.45, PORTAL_SCALE = 0.8;

// a camera that holds exactly matrix m (a world's code may read its position or rebuild its matrices)
function place(c, m) { c.matrix.copy(m); c.matrixWorld.copy(m); c.matrixWorldInverse.copy(m).invert(); m.decompose(c.position, c.quaternion, c.scale); }
// eye c's (asymmetric) frustum with a near and far of our own
function project(out, c, near, far) {
  const e = c.projectionMatrix.elements, l = (e[8] - 1) / e[0], r = (e[8] + 1) / e[0], b = (e[9] - 1) / e[5], t = (e[9] + 1) / e[5];
  out.near = near; out.far = far;
  out.projectionMatrix.makePerspective(l * near, r * near, t * near, b * near, near, far);
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert();
}
// camera.viewCamera, for the worlds' visibility checks (frustum culling, warming what comes into view): the union of the eyes'
// views, from their midpoint, facing as eye 0, with near and far of our own. (The camera handed to update() is the rig, which
// does not turn with the head: a world that culls by it would drop what the viewer turns to look at.) As in andybak/ai-portals.
// ponytail: the union is taken from the midpoint with the outer eyes' slopes, so it misses the 3 cm beside each eye at the near plane
function union(out, a, b, pa, pb, near, far) {
  const ea = pa.elements, eb = pb.elements;
  const l = Math.min((ea[8] - 1) / ea[0], (eb[8] - 1) / eb[0]), r = Math.max((ea[8] + 1) / ea[0], (eb[8] + 1) / eb[0]);
  const bt = Math.min((ea[9] - 1) / ea[5], (eb[9] - 1) / eb[5]), t = Math.max((ea[9] + 1) / ea[5], (eb[9] + 1) / eb[5]);
  _v.setFromMatrixPosition(a.matrixWorld).add(_f.setFromMatrixPosition(b.matrixWorld)).multiplyScalar(0.5);
  place(out, _M.compose(_v, a.quaternion, ONE));
  out.near = near; out.far = far; out.fov = 2 * Math.atan(Math.max(t, -bt)) * 180 / Math.PI; out.aspect = (r - l) / (t - bt);
  out.projectionMatrix.makePerspective(l * near, r * near, t * near, bt * near, near, far);
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert();
  return out;
}
const newCam = () => { const c = new THREE.PerspectiveCamera(); c.matrixAutoUpdate = false; return c; };

export class XRView {
  constructor(engine) {
    this.e = engine; this.yaw = 0; this.rig = new THREE.Matrix4(); this.target = null; this.scale = 0.75; this.minScale = MIN_SCALE;
    this.eyes = []; this.pcs = []; this.pv = []; this.toVP = [];
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: engine.rtType, samples: engine.samples });
    const xr = engine.renderer.xr;
    xr.enabled = false;          // on only for the last draw of a frame (Post.renderXR): every other draw goes to a buffer of ours
    xr.cameraAutoUpdate = false; // the eyes are placed here, on the rig
    xr.setReferenceSpaceType('local');
    xr.addEventListener('sessionstart', () => { this.scale = this.maxScale; engine.gov.reset(performance.now()); });
    xr.addEventListener('sessionend', () => { this.target = null; engine._resize(true); });   // (three has put the page's own size back by then)
  }
  get maxScale() { return SCALE[this.e.tier] ?? 0.75; }
  get hz() { return this.e.renderer.xr.getSession()?.frameRate || 72; }   // the headset's refresh rate (the Quest browser reports it)
  get on() { const x = this.e.renderer.xr; return x.isPresenting && x.getCamera().cameras.length > 0 && !!this.target; }
  static supported() { return navigator.xr ? navigator.xr.isSessionSupported('immersive-vr').catch(() => false) : Promise.resolve(false); }
  async toggle() {
    const xr = this.e.renderer.xr, s = xr.getSession();
    if (s) return s.end();
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['layers'] });
    session.addEventListener('select', () => this.e.skip());   // trigger: hurry to the next portal
    session.addEventListener('squeeze', () => { this.e.settings.paused = !this.e.settings.paused; });   // grip: pause
    await xr.setSession(session);
  }
  // called at the start of each animation frame: three has just set the headset's buffer as the render target
  begin() { const x = this.e.renderer.xr; this.target = x.isPresenting ? this.e.renderer.getRenderTarget() : null; }

  // The route's pose (cam's position, the eased gaze q) becomes the rig, and cam is left holding the rig: the engine and the
  // worlds see the body, not the head. A world that fixes things to its camera (a seat on a rocket, a ride, a companion)
  // then keeps them still while the viewer looks round; only the eyes carry the head's own pose.
  pose(cam, q) {
    _f.set(0, 0, -1).applyQuaternion(q);
    if (_f.x * _f.x + _f.z * _f.z > 0.01) this.yaw = Math.atan2(-_f.x, -_f.z);   // straight up or down: keep the last heading
    _q.setFromAxisAngle(Y, this.yaw); this.rig.compose(cam.position, _q, ONE);
    const xc = this.e.renderer.xr.getCamera().cameras;
    xc.forEach((c, i) => {
      if (!this.eyes[i]) { this.eyes[i] = newCam(); this.pcs[i] = newCam(); this.pv[i] = new THREE.Matrix4(); this.toVP[i] = new THREE.Matrix4(); }
      place(this.eyes[i], _M.multiplyMatrices(this.rig, c.matrix));
      // clip space of a whole picture to the part of the buffer that holds eye i (for the portal's look-up of the next world)
      const t = this.target, v = c.viewport, fx = v.x / t.width, fw = v.z / t.width, fy = v.y / t.height, fh = v.w / t.height;
      this.toVP[i].set(fw, 0, 0, 2 * fx + fw - 1, 0, fh, 0, 2 * fy + fh - 1, 0, 0, 1, 0, 0, 0, 0, 1);
    });
    cam.quaternion.copy(_q);
    const n = xc.length - 1, ve = this.ve || (this.ve = newCam());
    cam.viewCamera = union(ve, this.eyes[0], this.eyes[n], xc[0].projectionMatrix, xc[n].projectionMatrix, cam.near, cam.far);
    const e = xc[0].projectionMatrix.elements; cam.fov = 2 * Math.atan(1 / e[5]) * 180 / Math.PI; cam.aspect = e[5] / e[0];
  }

  // The buffers are made at the graphics level's most (top) and keep that size while the governor moves the scale: the eyes are
  // drawn into the lower-left part of them, k / top of each side (returned, kept on the buffer as rt.used), and read back from
  // there. Resizing a float, antialiased buffer each time the governor moved (usually a second or two into a world) is a
  // fresh allocation, which held the headset's frames.
  _fit(rt, k, top) {
    const t = this.target, w = Math.round(t.width * top), h = Math.round(t.height * top);
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    if (rt.samples !== this.e.samples) { rt.samples = this.e.samples; rt.dispose(); }
    return (rt.used = Math.min(1, k / top));
  }
  _viewport(rt, c) {
    const t = this.target, v = c.viewport, sx = rt.width * rt.used / t.width, sy = rt.height * rt.used / t.height;
    rt.viewport.set(Math.round(v.x * sx), Math.round(v.y * sy), Math.round(v.z * sx), Math.round(v.w * sy));
    rt.scissor.copy(rt.viewport); rt.scissorTest = true;
  }
  // Each eye draws a scene's shadow maps again unless told not to: the first eye draws them, the others reuse them.
  _eyes(draw) {
    const sm = this.e.renderer.shadowMap, auto = sm.autoUpdate;
    try { this.e.renderer.xr.getCamera().cameras.forEach((c, i) => { draw(c, i); sm.autoUpdate = false; sm.needsUpdate = false; }); }
    finally { sm.autoUpdate = auto; }
  }

  // The next world B through A's portal, once per eye into the engine's portal buffer (laid out as the headset's).
  portal(A, B, dt) {
    const e = this.e, r = e.renderer, P = A.portal, rim = P.rim, rt = e.portalRT, xc = r.xr.getCamera().cameras, box = [];
    const pu = this._fit(rt, this.scale * PORTAL_SCALE, this.maxScale * PORTAL_SCALE);
    _M.multiplyMatrices(B.entry, A.exitInv);
    xc.forEach((c, i) => {
      const pc = this.pcs[i];
      place(pc, _C.multiplyMatrices(_M, this.eyes[i].matrixWorld));
      _C.multiplyMatrices(pc.matrixWorldInverse, B.entry);   // portal space to this eye's camera in B
      let minDepth = Infinity; for (const p of rim) minDepth = Math.min(minDepth, -_v.copy(p).applyMatrix4(_C).z);
      project(pc, c, B.cam.nearThrough ?? Math.max(B.cam.near, minDepth * 0.96), B.cam.far);
      let x0 = 1, x1 = -1, y0 = 1, y1 = -1;
      for (const p of rim) {
        _v4.set(p.x, p.y, p.z, 1).applyMatrix4(_C).applyMatrix4(pc.projectionMatrix);
        if (_v4.w <= 1e-4) { x0 = y0 = -1; x1 = y1 = 1; break; }
        const x = _v4.x / _v4.w, y = _v4.y / _v4.w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      box[i] = [x0, x1, y0, y1];
      // (and from the whole buffer to its lower-left part in use: ndc' = pu * ndc + pu - 1)
      this.pv[i].multiplyMatrices(pc.projectionMatrix, _C).premultiply(this.toVP[i]).premultiply(_U.set(pu, 0, 0, pu - 1, 0, pu, 0, pu - 1, 0, 0, 1, 0, 0, 0, 0, 1));
    });
    // B's update() is handed the rig carried through the opening (as A's is handed the rig), with eye 0's lens
    const pb = this.pb || (this.pb = newCam()), p0 = this.pcs[0];
    place(pb, _C.multiplyMatrices(_M, this.rig)); pb.near = p0.near; pb.far = p0.far; pb.fov = e.camera.fov; pb.aspect = e.camera.aspect;
    pb.projectionMatrix.copy(p0.projectionMatrix); pb.projectionMatrixInverse.copy(p0.projectionMatrixInverse);
    const n = xc.length - 1, vb = this.vb || (this.vb = newCam());
    pb.viewCamera = union(vb, this.pcs[0], this.pcs[n], this.pcs[0].projectionMatrix, this.pcs[n].projectionMatrix, p0.near, p0.far);
    B.time += dt;
    if (!(B._ran && e.settings.paused)) { B._ran = true; try { B.world.update?.(dt, B.time, pb, 0); } catch (err) { if (!B._err) { B._err = 1; console.error(err); } } }
    this._eyes((c, i) => {
      this._viewport(rt, c);
      // only the opening's box (grown a little: the looks read the picture just outside the rim), within this eye's part
      const [x0, x1, y0, y1] = box[i], v = rt.viewport, px = 4 + 0.03 * v.z, py = 4 + 0.03 * v.w;
      const a = Math.max(v.x, Math.floor(v.x + (x0 * 0.5 + 0.5) * v.z - px)), b = Math.min(v.x + v.z, Math.ceil(v.x + (x1 * 0.5 + 0.5) * v.z + px));
      const c0 = Math.max(v.y, Math.floor(v.y + (y0 * 0.5 + 0.5) * v.w - py)), c1 = Math.min(v.y + v.w, Math.ceil(v.y + (y1 * 0.5 + 0.5) * v.w + py));
      if (b <= a || c1 <= c0) return;
      rt.scissor.set(a, c0, b - a, c1 - c0);
      r.setRenderTarget(rt); r.render(B.scene, this.pcs[i]);
    });
    r.setRenderTarget(null);
    B.drawn = true;
    return true;
  }

  // World A, once per eye, then graded onto the headset's buffer.
  render(A, cam, p, time, fade) {
    const r = this.e.renderer, rt = this.rt;
    this._fit(rt, this.scale, this.maxScale);
    this._eyes((c, i) => {
      project(this.eyes[i], c, cam.near, cam.far);
      this._viewport(rt, c);
      A.portal.setNextView(this.pv[i]);
      r.setRenderTarget(rt); r.render(A.scene, this.eyes[i]);
    });
    this.e.post.renderXR(rt, this.target, cam, p, time, fade, rt.used);
  }
}
