// c-blackhole — the hero canvas, ported 1:1 from the approved prototype
// (.scratch/bakers-docs-site/prototypes/landing-prototype.html, iterations
// 6-20): canvas rendition of Reflect's black-hole webm anatomy.
//
// All shadowBlur-heavy geometry is baked ONCE into two offscreen layers:
//   glowL (corona + orbit rings + flares) — drawn BEHIND the particles
//   holeL (core + mirror bow + photon ring) — drawn IN FRONT, swallows
//   whatever crosses it
// plus the four column-baked silk-hood mounds and one soft tail sprite.
// Per frame: a handful of drawImage calls + cheap particles. The rAF loop
// runs solely while the canvas is on screen and the tab is visible; under
// prefers-reduced-motion a single static frame is rendered.
//
// The disk (glow, hood, tails) is HARD-clipped to the live-measured
// pipeline frame width, so nothing ever exceeds the panel (iteration 19).

const TAU = Math.PI * 2

/* back easings for the ticket chips: a springy back.out scale-in on spawn,
 * and its reverse (back.in, gentle overshoot c1=1.2) on the capture — a
 * tiny outward/grow anticipation before gravity wins */
const BACK_C1 = 1.70158
const BACK_C3 = BACK_C1 + 1
const easeOutBack = (x: number) => 1 + BACK_C3 * Math.pow(x - 1, 3) + BACK_C1 * Math.pow(x - 1, 2)
const BACK_IN_C1 = 1.2
const easeInBackSoft = (x: number) => (BACK_IN_C1 + 1) * x * x * x - BACK_IN_C1 * x * x

/* spawn entrance duration in frames (~0.6s) — deliberately FASTER than
 * the ~2.2s capture spiral */
const SPAWN_FRAMES = 36

/* the HOOD: four nested silk layers — Gaussian mounds seated ON the disk
 * line, round over the dome, skirts flowing OUT along the equator, melting
 * into the side lines over the outer 30% (iterations 17-20) */
const HOOD = [
  { h: 2.3, s: 1.95, c: '150,110,255', a: 0.18, P: 5200, ph: 2.6 },
  { h: 1.95, s: 1.5, c: '186,148,255', a: 0.3, P: 4300, ph: 1.5 },
  { h: 1.6, s: 1.12, c: '224,196,255', a: 0.42, P: 3500, ph: 0.7 },
  { h: 1.3, s: 0.82, c: '255,248,255', a: 0.6, P: 2900, ph: 0 },
]

/* conventional commit types, each with a distinct saturated color
 * (iteration 10; chore dropped as too neutral) */
const TYPES: Array<[string, string]> = [
  ['feat', '#C08FFF'],
  ['fix', '#FF8DA1'],
  ['perf', '#FFC98F'],
  ['refactor', '#7FEFD2'],
  ['docs', '#8FB5FF'],
  ['test', '#FC72FF'],
  ['ci', '#9CE8FF'],
]

interface Dot {
  a: number
  r: number
  sp: number
  w: number
  s: number
}

interface Chip {
  a: number
  r: number
  sp: number
  w: number
  age: number
  type: string
  color: string
  id: string
  fall?: boolean
  ft?: number
  fr?: number
  fa?: number
}

interface Mound {
  cnv: HTMLCanvasElement
  hw: number
  hh: number
  P: number
  ph: number
}

interface Tail {
  dir: number
  off: number
  th: number
  len: number
  P: number
  ph: number
}

export interface BlackHole {
  destroy(): void
}

export function createBlackHole(
  canvas: HTMLCanvasElement,
  frameEl: HTMLElement,
  reduceMotion: boolean,
): BlackHole {
  const ctx = canvas.getContext('2d')!
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75)
  let W = 0
  let H = 0
  let CX = 0
  let CY = 0
  let R = 0
  let DISK = 0
  let PANEL_W = 0
  let glowL: HTMLCanvasElement
  let holeL: HTMLCanvasElement
  const YS = 0.16 /* the flat disk plane */
  const CHIP_YS = 0.52 /* chips ride a steeper inclined orbit */

  /* ---------- the silk hood (column-baked Gaussian mounds) ---------- */
  let mounds: Mound[] = []
  function bakeHood() {
    mounds = HOOD.map((m) => {
      const hw = Math.min(Math.floor(DISK) - 6, Math.ceil(m.s * R * 3.8))
      const hEff = Math.min(m.h * R, CY - 14)
      const hh = Math.ceil(hEff) + 2
      const cnv = document.createElement('canvas')
      cnv.width = hw * 2
      cnv.height = hh
      const c2 = cnv.getContext('2d')!
      /* column-wise: each vertical gradient runs to zero exactly AT the
       * Gaussian crest, so the layer's edge is silk-soft everywhere and
       * the skirts die out naturally toward the sides */
      for (let px = 0; px < hw * 2; px += 2) {
        const x = px - hw
        const crest = hh - hEff * Math.exp(-(x * x) / (2 * Math.pow(m.s * R, 2)))
        if (crest >= hh - 1) continue
        /* the skirts melt into the thin side lines well BEFORE the frame
         * edge: smooth horizontal fade over the outer 30% of the layer */
        let ef = Math.min(1, Math.max(0, (1 - Math.abs(x) / hw) / 0.3))
        ef = ef * ef * (3 - 2 * ef)
        if (ef <= 0.01) continue
        const a1 = m.a * ef
        const g = c2.createLinearGradient(0, hh, 0, crest)
        g.addColorStop(0, `rgba(${m.c},${a1})`)
        g.addColorStop(0.5, `rgba(${m.c},${a1 * 0.5})`)
        g.addColorStop(1, `rgba(${m.c},0)`)
        c2.fillStyle = g
        c2.fillRect(px, crest, 2, hh - crest)
      }
      return { cnv, hw, hh, P: m.P, ph: m.ph }
    })
  }
  function drawHood(t: number) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const m of mounds) {
      const p = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin((TAU * t) / m.P + m.ph)
      ctx.save()
      ctx.translate(CX, CY)
      ctx.scale(1 + 0.015 * p, 1 + 0.055 * p) /* the layer lifts upward as it brightens */
      ctx.globalAlpha = 0.62 + 0.38 * p
      ctx.drawImage(m.cnv, -m.hw, -m.hh, m.hw * 2, m.hh)
      ctx.restore()
    }
    ctx.restore()
  }

  /* ---------- side tails: soft puffs floating outward (iteration 18) ---------- */
  const tailSprite = document.createElement('canvas')
  tailSprite.width = 512
  tailSprite.height = 128
  {
    const s = tailSprite.getContext('2d')!
    s.save()
    s.translate(256, 64)
    s.scale(1, 0.22)
    const g = s.createRadialGradient(0, 0, 20, 0, 0, 244)
    g.addColorStop(0, 'rgba(232,204,255,.85)')
    g.addColorStop(0.45, 'rgba(186,140,255,.4)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    s.fillStyle = g
    s.fillRect(-256, -300, 512, 600)
    s.restore()
  }
  const TAILS: Tail[] = []
  for (const dir of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      TAILS.push({
        dir,
        off: -0.05 + i * 0.05,
        th: 0.07 + Math.random() * 0.05,
        len: 0.4 + Math.random() * 0.18,
        P: 5200 + Math.random() * 2600,
        ph: Math.random(),
      })
    }
  }
  function drawTails(t: number) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const tl of TAILS) {
      const u = reduceMotion ? 0.35 : (t / tl.P + tl.ph) % 1
      const lenPx = DISK * tl.len
      /* soft puff drifting outward, always fully INSIDE the panel width */
      const x0 = R * 0.9
      const x1 = DISK - lenPx / 2 - 6
      const xc = x0 + u * Math.max(40, x1 - x0)
      const th = R * tl.th
      ctx.globalAlpha = Math.sin(Math.PI * u) * 0.26
      ctx.drawImage(tailSprite, CX + tl.dir * xc - lenPx / 2, CY + R * tl.off - th, lenPx, th * 2)
    }
    ctx.restore()
  }

  /* ---------- baked layers ---------- */
  function bake() {
    glowL = document.createElement('canvas')
    holeL = document.createElement('canvas')
    for (const c of [glowL, holeL]) {
      c.width = W * dpr
      c.height = H * dpr
    }
    const g1 = glowL.getContext('2d')!
    g1.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g2 = holeL.getContext('2d')!
    g2.setTransform(dpr, 0, 0, dpr, 0, 0)

    /* --- glow layer --- */
    g1.globalCompositeOperation = 'lighter'
    let g = g1.createRadialGradient(CX, CY, R * 0.4, CX, CY, R * 3.2)
    g.addColorStop(0, 'rgba(143,104,255,.34)')
    g.addColorStop(0.45, 'rgba(143,104,255,.1)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    g1.fillStyle = g
    g1.beginPath()
    g1.ellipse(CX, CY, R * 3.2, R * 2.3, 0, 0, TAU)
    g1.fill()
    /* faint decorative orbit rings in the sky (reference still) */
    g1.strokeStyle = 'rgba(255,255,255,.05)'
    g1.lineWidth = 1
    g1.beginPath()
    g1.ellipse(CX, CY - R * 0.2, R * 2.7, R * 2.35, 0, Math.PI * 1.02, Math.PI * 1.98)
    g1.stroke()
    g1.strokeStyle = 'rgba(255,255,255,.035)'
    g1.beginPath()
    g1.ellipse(CX, CY - R * 0.1, R * 3.5, R * 3.0, 0, Math.PI * 1.04, Math.PI * 1.96)
    g1.stroke()
    /* flares: even-odd clipped OUTSIDE the silhouette — no tail crosses
     * the black area */
    g1.save()
    g1.beginPath()
    g1.rect(0, 0, W, H)
    g1.arc(CX, CY, R * 0.99, 0, TAU)
    g1.clip('evenodd')
    g1.save()
    g1.translate(CX, CY)
    g1.scale(1, 0.022)
    g = g1.createRadialGradient(0, 0, R * 0.5, 0, 0, DISK)
    g.addColorStop(0, 'rgba(255,248,255,.9)')
    g.addColorStop(0.3, 'rgba(214,170,255,.6)')
    g.addColorStop(0.65, 'rgba(143,104,255,.24)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    g1.fillStyle = g
    g1.beginPath()
    g1.arc(0, 0, DISK, 0, TAU)
    g1.fill()
    g1.restore()
    g1.save()
    g1.translate(CX, CY)
    g1.scale(1, 0.07)
    g = g1.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 2.4)
    g.addColorStop(0, 'rgba(255,246,255,.95)')
    g.addColorStop(0.45, 'rgba(198,148,255,.5)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    g1.fillStyle = g
    g1.beginPath()
    g1.arc(0, 0, R * 2.4, 0, TAU)
    g1.fill()
    g1.restore()
    g1.restore()

    /* --- hole layer --- */
    /* mirrored under-ring */
    g2.save()
    g2.globalCompositeOperation = 'lighter'
    g2.strokeStyle = 'rgba(220,182,255,.8)'
    g2.lineWidth = 6
    g2.lineCap = 'round'
    g2.shadowColor = 'rgba(186,132,255,.95)'
    g2.shadowBlur = 30
    g2.beginPath()
    g2.arc(CX, CY, R * 1.22, Math.PI * 0.1, Math.PI * 0.9)
    g2.stroke()
    g2.globalAlpha = 0.5
    g2.lineWidth = 12
    g2.shadowBlur = 60
    g2.beginPath()
    g2.arc(CX, CY, R * 1.3, Math.PI * 0.18, Math.PI * 0.82)
    g2.stroke()
    g2.restore()
    /* violet-lit core: in the video almost nothing reads as flat black */
    let gg = g2.createRadialGradient(CX, CY - R * 0.15, R * 0.1, CX, CY, R * 0.96)
    gg.addColorStop(0, '#120b26')
    gg.addColorStop(0.6, '#1a1140')
    gg.addColorStop(1, '#2c1b56')
    g2.fillStyle = gg
    g2.beginPath()
    g2.arc(CX, CY, R * 0.96, 0, TAU)
    g2.fill()
    /* the lensed lower image sits INSIDE the sphere and floods its lower
     * half with light (removes the black space, video-true) */
    g2.save()
    g2.beginPath()
    g2.arc(CX, CY, R * 0.96, 0, TAU)
    g2.clip()
    g2.globalCompositeOperation = 'lighter'
    gg = g2.createRadialGradient(CX, CY + R * 0.55, R * 0.05, CX, CY + R * 0.55, R * 0.85)
    gg.addColorStop(0, 'rgba(214,170,255,.4)')
    gg.addColorStop(0.6, 'rgba(150,110,255,.18)')
    gg.addColorStop(1, 'rgba(0,0,0,0)')
    g2.fillStyle = gg
    g2.fillRect(CX - R, CY - R, R * 2, R * 2)
    g2.strokeStyle = 'rgba(235,204,255,.95)'
    g2.lineWidth = 7
    g2.lineCap = 'round'
    g2.shadowColor = 'rgba(196,148,255,1)'
    g2.shadowBlur = 24
    g2.beginPath()
    g2.arc(CX, CY + R * 0.16, R * 0.7, Math.PI * 0.06, Math.PI * 0.94)
    g2.stroke()
    g2.globalAlpha = 0.55
    g2.lineWidth = 16
    g2.shadowBlur = 46
    g2.beginPath()
    g2.arc(CX, CY + R * 0.18, R * 0.74, Math.PI * 0.12, Math.PI * 0.88)
    g2.stroke()
    g2.restore()
    g2.save()
    g2.globalCompositeOperation = 'lighter'
    gg = g2.createRadialGradient(CX, CY, R * 0.45, CX, CY, R)
    gg.addColorStop(0, 'rgba(0,0,0,0)')
    gg.addColorStop(0.68, 'rgba(143,104,255,.24)')
    gg.addColorStop(1, 'rgba(214,170,255,.7)')
    g2.fillStyle = gg
    g2.beginPath()
    g2.arc(CX, CY, R, 0, TAU)
    g2.fill()
    /* feathered photon ring: a bright core bleeding SOFTLY both inward and
     * outward — the ring tapers off instead of ending hard */
    gg = g2.createRadialGradient(CX, CY, R * 0.74, CX, CY, R * 1.3)
    gg.addColorStop(0, 'rgba(0,0,0,0)')
    gg.addColorStop(0.3, 'rgba(206,158,255,.34)')
    gg.addColorStop(0.46, 'rgba(255,250,255,.92)')
    gg.addColorStop(0.6, 'rgba(196,148,255,.42)')
    gg.addColorStop(1, 'rgba(0,0,0,0)')
    g2.fillStyle = gg
    g2.beginPath()
    g2.arc(CX, CY, R * 1.3, 0, TAU)
    g2.fill()
    g2.strokeStyle = 'rgba(255,252,255,.85)'
    g2.lineWidth = 2.5
    g2.shadowColor = 'rgba(214,170,255,.9)'
    g2.shadowBlur = 18
    g2.beginPath()
    g2.arc(CX, CY, R, 0, TAU)
    g2.stroke()
    g2.restore()
    bakeHood()
  }

  function size() {
    W = canvas.clientWidth
    H = canvas.clientHeight
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    CX = W / 2
    /* keep in sync with the pipeline frame's negative margin-top */
    CY = H - (W <= 860 ? 200 : 282)
    R = Math.min(W, 1200) * 0.125
    /* flare tips end exactly at the pipeline frame's edges: measure the
     * REAL frame (iteration 19) */
    PANEL_W = frameEl ? frameEl.getBoundingClientRect().width : Math.min(1120, W)
    DISK = Math.min(PANEL_W / 2 - 6, W / 2 - 8)
    bake()
  }

  /* ---------- particles ---------- */
  const dots: Dot[] = []
  const chips: Chip[] = []
  /* orbits stay inside the stage: max radius = the canvas half-width */
  const rMax = () => Math.max(R * 2.4, W / 2 - 70)
  function spawnDot() {
    dots.push({
      a: Math.random() * TAU,
      r: R * 1.1 + Math.random() * (Math.min(DISK, rMax()) - R * 1.1),
      sp: 0.02 + Math.random() * 0.06,
      w: 0.005 + Math.random() * 0.009,
      s: 0.7 + Math.random() * 1.5,
    })
  }
  function spawnChip(far: boolean) {
    const t = TYPES[Math.floor(Math.random() * TYPES.length)]
    chips.push({
      /* upper hemisphere only, spawned fully INSIDE the visible stage
       * (never in the edge-fade zone), then arcing high above the sphere
       * into the horizon */
      a: -Math.PI + 0.6 + Math.random() * (Math.PI - 1.2),
      r: far
        ? Math.min(DISK + 40, rMax() - 70) + Math.random() * 40
        : R * 1.8 + Math.random() * (Math.min(DISK, rMax() - 70) - R * 1.8),
      sp: 0.09 + Math.random() * 0.05,
      w: (Math.random() < 0.5 ? 1 : -1) * (0.0009 + Math.random() * 0.0006),
      age: 0,
      type: t[0],
      color: t[1],
      id: '#' + (3 + Math.floor(Math.random() * 480)),
    })
  }

  const pos = (p: Dot): [number, number] => [
    CX + Math.cos(p.a) * p.r,
    CY + Math.sin(p.a) * p.r * YS,
  ]
  const posChip = (p: Chip): [number, number] => [
    CX + Math.cos(p.a) * p.r,
    CY + Math.sin(p.a) * p.r * CHIP_YS,
  ]

  function update() {
    if (reduceMotion) return
    for (let i = dots.length - 1; i >= 0; i--) {
      const p = dots[i]
      p.a += p.w * ((R * 2) / p.r)
      p.r -= p.sp
      if (p.r < R * 1.02) {
        dots.splice(i, 1)
        spawnDot()
      }
    }
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i]
      if (c.fall) {
        /* capture phase: slightly faster than orbit, easing IN (gravity) */
        c.ft! += 0.0075
        if (c.ft! >= 1) {
          chips.splice(i, 1)
          spawnChip(true)
        }
        continue
      }
      c.age++
      const pull = 1 + (1 - Math.min(1, (c.r - R) / DISK)) * 1.2
      c.r -= c.sp * pull
      c.a += c.w * ((R * 2) / c.r) * 2
      /* stay in the upper hemisphere: CLAMP at the bounds (no jitter) */
      if (c.a > -0.45) {
        c.a = -0.45
        c.w = -Math.abs(c.w)
      } else if (c.a < -Math.PI + 0.45) {
        c.a = -Math.PI + 0.45
        c.w = Math.abs(c.w)
      }
      /* close enough: hand over to the capture spiral */
      if (c.r < R * 1.5) {
        const [x, y] = posChip(c)
        c.fall = true
        c.ft = 0
        c.fr = Math.hypot(x - CX, y - CY)
        c.fa = Math.atan2(y - CY, x - CX)
      }
    }
  }

  function drawDots() {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of dots) {
      const [x, y] = pos(p)
      const depth = (Math.sin(p.a) + 1) / 2
      ctx.fillStyle = `rgba(210,170,255,${0.12 + depth * 0.5})`
      ctx.beginPath()
      ctx.arc(x, y, p.s * (0.7 + depth * 0.5), 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }

  function drawChipPass(nearPass: boolean) {
    /* far pass: approach arcs behind the hole; near pass: the capture
     * spiral IN FRONT (ease-in pow 1.7 — accelerates INTO the hole) */
    for (const c of chips) {
      if (!!c.fall !== nearPass) continue
      let x: number, y: number, alpha: number, scale: number
      if (c.fall) {
        const t = c.ft!
        /* back.in: brief outward drift + slight grow (anticipation), then
         * the accelerating plunge — gravity still reads as gravity */
        const e = reduceMotion ? Math.pow(t, 1.7) : easeInBackSoft(t)
        const rr = c.fr! * (1 - e)
        const aa = c.fa! + 1.5 * e /* spiral wind-in */
        x = CX + Math.cos(aa) * rr
        y = CY + Math.sin(aa) * rr
        scale = 1 - 0.82 * e
        alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / 0.5)
      } else {
        ;[x, y] = posChip(c)
        if (y < -30) continue
        const dist = Math.max(0, Math.min(1, (c.r - R) / 340))
        alpha = 0.55 + (1 - dist) * 0.45
        scale = 0.82 + (1 - dist) * 0.18
        /* spawn entrance: back.out scale-in (overshoot + settle), alpha
         * slightly ahead of the scale so the pop stays soft */
        if (!reduceMotion) {
          scale *= easeOutBack(Math.min(1, c.age / SPAWN_FRAMES))
          alpha *= Math.min(1, c.age / 24)
        }
      }
      /* wide edge fade: nothing pokes out of the stage */
      alpha *= Math.max(0, Math.min(1, Math.min(x, W - x) / 140))
      if (alpha <= 0.01) continue
      ctx.font = `600 ${(11.5 * scale).toFixed(1)}px ui-monospace, Menlo, monospace`
      const t1 = c.type
      const t2 = ' · ' + c.id
      const w1 = ctx.measureText(t1).width
      const w2 = ctx.measureText(t2).width
      const tw = w1 + w2
      const pw = tw + 22 * scale
      const ph = 24 * scale
      const rx = 9 * scale
      ctx.globalAlpha = alpha
      ctx.fillStyle = 'rgba(22,18,40,.92)'
      ctx.strokeStyle = 'rgba(186,156,255,.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, rx)
      ctx.fill()
      ctx.stroke()
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = c.color
      ctx.fillText(t1, x - tw / 2, y + 0.5)
      ctx.fillStyle = '#DCCFFF'
      ctx.fillText(t2, x - tw / 2 + w1, y + 0.5)
      ctx.globalAlpha = 1
    }
  }

  function frame(t: number) {
    ctx.clearRect(0, 0, W, H)
    /* HARD safety clip: nothing disk-bound may exceed the frame width */
    ctx.save()
    ctx.beginPath()
    ctx.rect(CX - PANEL_W / 2, 0, PANEL_W, H)
    ctx.clip()
    /* breathing via layer alpha, not per-frame blur (period ~4.2s) */
    ctx.globalAlpha = reduceMotion ? 1 : 0.78 + 0.22 * (0.5 + 0.5 * Math.sin((TAU * t) / 4200))
    ctx.drawImage(glowL, 0, 0, W, H)
    ctx.globalAlpha = 1
    drawHood(t) /* silk hood: nested layers breathing upward */
    drawTails(t) /* side tails floating outward along the disk plane */
    ctx.restore()
    update()
    drawDots()
    drawChipPass(false) /* far side: swallowed by the hole layer */
    ctx.drawImage(holeL, 0, 0, W, H)
    if (!reduceMotion) {
      /* white top highlight shimmer on the ring */
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + 0.35 * (0.5 + 0.5 * Math.sin((TAU * t) / 2200))})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(CX, CY, R, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
      ctx.restore()
    }
    drawChipPass(true) /* near side: in front, burns up at the ring */
  }

  /* ---------- lifecycle: run only while visible ---------- */
  size()
  for (let i = 0; i < 130; i++) spawnDot()
  for (let i = 0; i < 7; i++) spawnChip(i > 2)

  let running = false
  let inView = false
  let destroyed = false
  function loop(t: number) {
    if (!running || destroyed) return
    frame(t)
    requestAnimationFrame(loop)
  }
  function refresh() {
    const want = inView && !document.hidden && !reduceMotion && !destroyed
    if (want && !running) {
      running = true
      requestAnimationFrame(loop)
    }
    if (!want) running = false
  }
  const io = new IntersectionObserver(
    (es) => {
      inView = es[0].isIntersecting
      refresh()
      if (inView && reduceMotion) frame(0)
    },
    { rootMargin: '60px' },
  )
  io.observe(canvas)
  const onVisibility = () => refresh()
  const onResize = () => {
    size()
    if (!running) frame(0)
  }
  document.addEventListener('visibilitychange', onVisibility)
  addEventListener('resize', onResize)
  frame(0)
  refresh()

  return {
    destroy() {
      destroyed = true
      running = false
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      removeEventListener('resize', onResize)
    },
  }
}
