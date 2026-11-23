export type Pt = [number, number];
/** Corners in normalized (0..1) coordinates of the EXIF-oriented source: TL, TR, BR, BL. */
export type Quad = [Pt, Pt, Pt, Pt];

export interface EditParams {
  corners: Quad;
  rotation: 0 | 90 | 180 | 270;
  color: 'original' | 'bw';
  brightness: number; // -100..100
  contrast: number; // -100..100
  autoDetected?: boolean;
}

export type TemplateKind = 'plain' | 'border' | 'story';
export interface TemplateParams {
  kind: TemplateKind;
  title: string;
  showDate: boolean;
  showPeople: boolean;
}

export type DatePrecision = 'exact' | 'year' | 'approx' | 'decade' | 'unknown';
export interface PhotoDate {
  precision: DatePrecision;
  /** exact: YYYY-MM-DD; year/approx: YYYY; decade: YYYY (first year of decade) */
  value?: string;
}

export interface Photo {
  id: string;
  originalAssetId: string;
  masterAssetId: string;
  thumbAssetId: string;
  originalName: string;
  originalType: string;
  exifOrientation: number;
  width: number;
  height: number;
  edit: EditParams;
  template: TemplateParams;
  date: PhotoDate;
  title: string;
  place: string;
  notes: string;
  /** Manually marked as organized even if date / people are missing. */
  organized: boolean;
  createdAt: number;
  scannedAt: number;
  updatedAt: number;
  trashedAt?: number;
}

export interface Person {
  id: string;
  displayName: string;
  fullName?: string;
  birthYear?: number;
  createdAt: number;
}

export type RelType = 'parent_of' | 'partner_of';
export interface Relationship {
  /** Deterministic: `${type}:${a}:${b}`; partner pairs are sorted so duplicates collide. */
  id: string;
  type: RelType;
  a: string; // parent_of: a is parent of b
  b: string;
}

export interface PhotoPerson {
  photoId: string;
  personId: string;
}

export type AssetPurpose = 'original' | 'master' | 'thumb';
export interface Asset {
  id: string;
  purpose: AssetPurpose;
  type: string;
  size: number;
  blob: Blob;
  sha256?: string;
  crc32?: number;
}

export type DraftStage = 'pending' | 'failed';
export interface Draft {
  id: string;
  /** Pre-assigned so a retried save can never create a duplicate photo. */
  photoId: string;
  seq: number;
  originalAssetId: string;
  fileName: string;
  fileType: string;
  source: 'camera' | 'import';
  stage: DraftStage;
  params?: EditParams;
  error?: string;
  createdAt: number;
}

export interface Settings {
  meId?: string;
  lastBackupAt?: number;
  entryNoticeDismissed?: boolean;
  stickyMeta?: boolean;
}
