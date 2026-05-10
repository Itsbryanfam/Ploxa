import { z } from "zod";

// RAWG search result item — minimal fields we use.
export const RawgSearchItemSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  released: z.string().nullable().optional(),
  background_image: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  metacritic: z.number().nullable().optional(),
  parent_platforms: z
    .array(z.object({ platform: z.object({ name: z.string() }) }))
    .nullable()
    .optional(),
});

export const RawgSearchResponseSchema = z.object({
  count: z.number(),
  results: z.array(RawgSearchItemSchema),
});

// Game detail — richer; only fields we render.
export const RawgGameDetailSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  released: z.string().nullable().optional(),
  background_image: z.string().nullable().optional(),
  description_raw: z.string().optional(),
  rating: z.number().nullable().optional(),
  metacritic: z.number().nullable().optional(),
  playtime: z.number().optional(), // hours, RAWG average
  genres: z.array(z.object({ name: z.string() })).optional(),
  themes: z.array(z.object({ name: z.string() })).optional(),
  tags: z.array(z.object({ name: z.string() })).optional(),
  platforms: z.array(z.object({ platform: z.object({ name: z.string() }) })).optional(),
});

export const RawgScreenshotsSchema = z.object({
  results: z.array(z.object({ id: z.number(), image: z.string() })),
});

export type RawgSearchItem = z.infer<typeof RawgSearchItemSchema>;
export type RawgSearchResponse = z.infer<typeof RawgSearchResponseSchema>;
export type RawgGameDetail = z.infer<typeof RawgGameDetailSchema>;
export type RawgScreenshots = z.infer<typeof RawgScreenshotsSchema>;
