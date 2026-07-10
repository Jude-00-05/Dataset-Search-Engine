import { deepSearchDatasets } from "./_lib/deepSearchService.js";

export default async function handler(req, res) {
  const query = String(req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({
      error: "Missing search query.",
      query,
      total: 0,
      results: [],
      sources: [],
    });
  }

  try {
    const payload = await deepSearchDatasets(query);
    return res.status(200).json(payload);
  } catch (error) {
    console.error("[deep-search] request failed", error);
    return res.status(502).json({
      error: "Deep Search is temporarily unavailable.",
      query,
      total: 0,
      results: [],
      sources: [],
    });
  }
}
