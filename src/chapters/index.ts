import * as THREE from 'three'
import { Chapter, ChapterContext } from '../engine/ChapterManager'
import { Chapter01_ExploreTheSculpture } from './Chapter01_ExploreTheSculpture'
import { Chapter02_RevealTheHeartline } from './Chapter02_RevealTheHeartline'

export { Chapter01_ExploreTheSculpture, Chapter02_RevealTheHeartline }

class BaseChapter implements Chapter {
  id: string
  name: string
  protected color: number
  protected ctx: ChapterContext | null = null

  constructor(id: string, name: string, color: number) {
    this.id = id
    this.name = name
    this.color = color
  }

  init(context: ChapterContext): void {
    this.ctx = context
    console.log(`[${this.id}] Initialized`)
  }

  enter(): void {
    console.log(`[${this.id}] ▶ Enter: ${this.name}`)
    if (this.ctx) {
      (this.ctx.scene.background as THREE.Color)?.set(this.color)
    }
  }

  update(_localT: number, _globalT: number): void {
  }

  exit(): void {
    console.log(`[${this.id}] ◀ Exit: ${this.name}`)
  }
}

export class Chapter03_CornersOfThePath extends BaseChapter {
  constructor() {
    super('ch03', 'Corners of the Path', 0x0a0a1a)
  }
}

export class Chapter04_Constellations extends BaseChapter {
  constructor() {
    super('ch04', 'Constellations', 0x0a0a22)
  }
}

export class Chapter05_FromStarsToLattice extends BaseChapter {
  constructor() {
    super('ch05', 'From Stars to Lattice', 0x0a0a2a)
  }
}

export class Chapter06_TheSpaceOfPossibilities extends BaseChapter {
  constructor() {
    super('ch06', 'The Space of Possibilities', 0x0a0a32)
  }
}

export class Chapter07_PathSearchSpheres extends BaseChapter {
  constructor() {
    super('ch07', 'Path Search — Spheres', 0x0a0a3a)
  }
}

export class Chapter08_PathSearchSticks extends BaseChapter {
  constructor() {
    super('ch08', 'Path Search — Sticks', 0x0a0a42)
  }
}

export class Chapter09_ChosenPath extends BaseChapter {
  constructor() {
    super('ch09', 'Chosen Path', 0x0a0a4a)
  }
}

export class Chapter10_Perspectives extends BaseChapter {
  constructor() {
    super('ch10', 'Perspectives', 0x0a0a52)
  }
}

export class Chapter11_ReturnToTheCurve extends BaseChapter {
  constructor() {
    super('ch11', 'Return to the Curve', 0x0a0a5a)
  }
}

export class Chapter12_ReformingTheSculpture extends BaseChapter {
  constructor() {
    super('ch12', 'Reforming the Sculpture', 0x0a0a62)
  }
}

export const allChapters: Chapter[] = [
  new Chapter01_ExploreTheSculpture(),
  new Chapter02_RevealTheHeartline(),
  new Chapter03_CornersOfThePath(),
  new Chapter04_Constellations(),
  new Chapter05_FromStarsToLattice(),
  new Chapter06_TheSpaceOfPossibilities(),
  new Chapter07_PathSearchSpheres(),
  new Chapter08_PathSearchSticks(),
  new Chapter09_ChosenPath(),
  new Chapter10_Perspectives(),
  new Chapter11_ReturnToTheCurve(),
  new Chapter12_ReformingTheSculpture(),
]

export default allChapters
