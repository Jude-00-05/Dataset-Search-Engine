import { buildFilters, getSearchResponse } from "./_lib/searchService.js";

export default function handler(req, res) {
  const query = String(req.query.q || "").trim();
  const filters = buildFilters(req.query);
  const payload = getSearchResponse(query, filters);
  res.status(200).json(payload);
}
