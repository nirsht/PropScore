import { z } from "zod";
import { RenovationLevelEnum } from "@/server/agents/building-vision/schema";

export { RenovationLevelEnum };

export const RoomTypeEnum = z.enum([
  "kitchen",
  "bathroom",
  "bedroom",
  "living",
  "hallway",
  "closet",
  "laundry",
  "floor_detail",
  "fixture_detail",
  "exterior",
  "other",
]);
export type RoomType = z.infer<typeof RoomTypeEnum>;

export const InteriorVisionInput = z.object({
  mlsId: z.string(),
});

export const PhotoTag = z.object({
  index: z.number().int().min(0),
  roomType: RoomTypeEnum,
  usefulnessForCondition: z.number().min(0).max(1),
});
export type PhotoTag = z.infer<typeof PhotoTag>;

export const PhotoFinding = z.object({
  photoUrl: z.string().url(),
  roomType: RoomTypeEnum,
  conditionScore: z.number().min(0).max(100),
  observations: z.array(z.string().min(1).max(240)).max(8),
});
export type PhotoFinding = z.infer<typeof PhotoFinding>;

export const InteriorVisionOutput = z.object({
  photoCount: z.number().int().min(0),
  selectedPhotoUrls: z.array(z.string().url()).max(2),
  perPhoto: z.array(PhotoFinding).max(2),
  renovationLevel: RenovationLevelEnum.nullable(),
  renovationConfidence: z.number().min(0).max(1).nullable(),
  rationale: z.string(),
  skipReason: z.string().nullable(),
});
export type InteriorVisionOutput = z.infer<typeof InteriorVisionOutput>;
