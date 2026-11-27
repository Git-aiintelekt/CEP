/** What an MMS picture may be: the same rules the server applies when the template is saved (templates/design.py). */
export const MMS_TYPES = ['image/jpeg', 'image/png', 'image/gif']
export const MMS_WARN_BYTES = 600 * 1024
export const MMS_MAX_BYTES = 1024 * 1024
export const MMS_MIN_PX = 600

export const MMS_RULES = `JPEG, PNG or GIF, at least ${MMS_MIN_PX} × ${MMS_MIN_PX} pixels and up to 1 MB. Under 600 KB is delivered reliably by every carrier.`

type Sized = { width_px: number | null; height_px: number | null }

/** A picture whose size is known and is under the minimum on either side; an unknown size is left to the server. */
export const tooSmall = (picture: Sized) =>
  picture.width_px != null && picture.height_px != null && (picture.width_px < MMS_MIN_PX || picture.height_px < MMS_MIN_PX)

export const tooSmallText = (picture: Sized) =>
  `The picture is ${picture.width_px} × ${picture.height_px} pixels. MMS pictures must be at least ${MMS_MIN_PX} × ${MMS_MIN_PX}.`
