import { getSourceStats } from "./_lib/searchService.js";

export default function handler(req, res) {
  res.status(200).json(getSourceStats());
}
