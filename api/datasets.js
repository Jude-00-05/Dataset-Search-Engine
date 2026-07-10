import { buildFilters, getDatasets } from "./_lib/searchService.js";

export default function handler(req, res) {
  const filters = buildFilters(req.query);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 48);
  res.status(200).json(getDatasets(filters, page, limit));
}
