import { useEffect, useMemo, useState } from "react";
import "./App.css";

const FEATURED_QUERIES = [
  "fresh vs rotten fruits",
  "mental health csv",
  "image classification datasets",
  "indian traffic dataset",
];

const FILTER_LABELS = {
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
  unknown: "Unknown",
  open: "Open",
  commercial_friendly: "Commercial Friendly",
  research: "Research Only",
  restrictive: "Restrictive",
  tabular: "Tabular",
  text: "Text",
  image: "Image",
  audio: "Audio",
  video: "Video",
  geospatial: "Geospatial",
  time_series: "Time Series",
  code: "Code",
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  last_year: "Updated This Year",
  last_3_years: "Updated In 3 Years",
  older: "Older",
};

function formatLabel(value) {
  if (FILTER_LABELS[value]) {
    return FILTER_LABELS[value];
  }

  return String(value)
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildParams(query, filters, page = 1, limit = 12) {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (filters.sources.length) {
    params.set("sources", filters.sources.join(","));
  }
  if (filters.formats.length) {
    params.set("formats", filters.formats.join(","));
  }
  if (filters.tasks.length) {
    params.set("tasks", filters.tasks.join(","));
  }
  if (filters.languages.length) {
    params.set("languages", filters.languages.join(","));
  }
  if (filters.licenses.length) {
    params.set("licenses", filters.licenses.join(","));
  }
  if (filters.modalities.length) {
    params.set("modalities", filters.modalities.join(","));
  }
  if (filters.sizes.length) {
    params.set("sizes", filters.sizes.join(","));
  }
  if (filters.updated.length) {
    params.set("updated", filters.updated.join(","));
  }
  params.set("page", String(page));
  params.set("limit", String(limit));
  return params.toString();
}

function ToggleGroup({ title, items, selected, onToggle }) {
  if (!items.length) {
    return null;
  }

  return (
    <section className="filter-group">
      <div className="filter-heading-row">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      <div className="chip-grid">
        {items.map((item) => {
          const value = item.value || item;
          const label = item.label || formatLabel(value);
          const count = item.count;
          const active = selected.includes(value);

          return (
            <button
              key={value}
              type="button"
              className={`filter-chip ${active ? "active" : ""}`}
              onClick={() => onToggle(value)}
            >
              <span>{label}</span>
              {typeof count === "number" ? <strong>{count}</strong> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ResultCard({ dataset }) {
  return (
    <article className="result-card">
      <div className="result-card-top">
        <div className="result-card-badges">
          <span className={`source-badge source-${dataset.source}`}>{formatLabel(dataset.source)}</span>
          {dataset.deep ? <span className="live-badge">LIVE</span> : null}
        </div>
        <span className="score-pill">Score {dataset.score || 0}</span>
      </div>

      <div className="result-copy">
        <a href={dataset.url} target="_blank" rel="noreferrer" className="result-title">
          {dataset.title}
        </a>
        <p>{dataset.description}</p>
      </div>

      <div className="meta-row">
        <span>{dataset.license}</span>
        <span>{dataset.size}</span>
        <span>{dataset.last_updated}</span>
      </div>

      <div className="token-row">
        {dataset.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="token tag-token">
            {tag}
          </span>
        ))}
      </div>

      <div className="token-row">
        {(dataset.modalities || []).slice(0, 3).map((modality) => (
          <span key={modality} className="token modality-token">
            {formatLabel(modality)}
          </span>
        ))}
        {dataset.task_types.map((task) => (
          <span key={task} className="token task-token">
            {formatLabel(task)}
          </span>
        ))}
        {dataset.formats.map((format) => (
          <span key={format} className="token format-token">
            {format.toUpperCase()}
          </span>
        ))}
      </div>

      <div className="result-card-footer">
        <div className="downloads">
          <strong>{dataset.downloads?.toLocaleString?.() || dataset.downloads}</strong>
          <span>downloads</span>
        </div>
        <a href={dataset.url} target="_blank" rel="noreferrer" className="open-button">
          Open Dataset
        </a>
      </div>
    </article>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Search icon">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16L21 21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [filters, setFilters] = useState({
    sources: [],
    formats: [],
    tasks: [],
    languages: [],
    licenses: [],
    modalities: [],
    sizes: [],
    updated: [],
  });
  const [results, setResults] = useState([]);
  const [availableFilters, setAvailableFilters] = useState({
    sources: {},
    formats: {},
    task_types: {},
    languages: {},
    licenses: {},
    modalities: {},
    sizes: {},
    updated: {},
  });
  const [sourceStats, setSourceStats] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [deepResults, setDeepResults] = useState([]);
  const [deepSources, setDeepSources] = useState([]);
  const [deepTotal, setDeepTotal] = useState(0);
  const [isDeepLoading, setIsDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState("");

  const sourceItems = useMemo(
    () =>
      Object.entries(availableFilters.sources || {}).map(([value, count]) => ({
        value,
        label: formatLabel(value),
        count,
      })),
    [availableFilters.sources]
  );

  const formatItems = useMemo(
    () =>
      Object.entries(availableFilters.formats || {}).map(([value, count]) => ({
        value,
        label: value.toUpperCase(),
        count,
      })),
    [availableFilters.formats]
  );

  const taskItems = useMemo(
    () =>
      Object.entries(availableFilters.task_types || {}).map(([value, count]) => ({
        value,
        label: formatLabel(value),
        count,
      })),
    [availableFilters.task_types]
  );

  const languageItems = useMemo(
    () =>
      Object.entries(availableFilters.languages || {}).map(([value, count]) => ({
        value,
        label: formatLabel(value),
        count,
      })),
    [availableFilters.languages]
  );

  const licenseItems = useMemo(
    () =>
      Object.entries(availableFilters.licenses || {}).map(([value, count]) => ({
        value,
        label: formatLabel(value),
        count,
      })),
    [availableFilters.licenses]
  );

  const modalityItems = useMemo(
    () =>
      Object.entries(availableFilters.modalities || {}).map(([value, count]) => ({
        value,
        label: formatLabel(value),
        count,
      })),
    [availableFilters.modalities]
  );

  const sizeItems = useMemo(
    () =>
      Object.entries(availableFilters.sizes || {}).map(([value, count]) => ({
        value,
        label: formatLabel(value),
        count,
      })),
    [availableFilters.sizes]
  );

  const updatedItems = useMemo(
    () =>
      Object.entries(availableFilters.updated || {}).map(([value, count]) => ({
        value,
        label: formatLabel(value),
        count,
      })),
    [availableFilters.updated]
  );

  const fetchSources = async () => {
    const response = await fetch("/api/sources");
    const data = await response.json();
    setSourceStats(data.sources || []);
  };

  const loadResults = async (nextQuery, nextFilters) => {
    setIsLoading(true);
    setError("");

    try {
      const endpoint = nextQuery.trim()
        ? `/api/search?${buildParams(nextQuery, nextFilters, 1, 24)}`
        : `/api/datasets?${buildParams("", nextFilters, 1, 24)}`;
      const response = await fetch(endpoint);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to load datasets.");
      }

      const nextResults = data.results || [];
      setResults(nextResults);
      setTotalResults(data.total || nextResults.length);
      setAvailableFilters(
        data.available_filters || {
          sources: {},
          formats: {},
          task_types: {},
          languages: {},
          licenses: {},
          modalities: {},
          sizes: {},
          updated: {},
        }
      );
    } catch (requestError) {
      setResults([]);
      setTotalResults(0);
      setAvailableFilters({
        sources: {},
        formats: {},
        task_types: {},
        languages: {},
        licenses: {},
        modalities: {},
        sizes: {},
        updated: {},
      });
      setError(requestError.message || "Unable to load datasets.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSources().catch(() => {
      setSourceStats([]);
    });
  }, []);

  useEffect(() => {
    loadResults(submittedQuery, filters);
    setDeepResults([]);
    setDeepSources([]);
    setDeepTotal(0);
    setDeepError("");
    setIsDeepLoading(false);
  }, [submittedQuery, filters]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  };

  const handleFeaturedQuery = (value) => {
    setQuery(value);
    setSubmittedQuery(value);
  };

  const toggleFilter = (group, value) => {
    setFilters((current) => {
      const exists = current[group].includes(value);
      return {
        ...current,
        [group]: exists
          ? current[group].filter((item) => item !== value)
          : [...current[group], value],
      };
    });
  };

  const clearFilters = () => {
    setFilters({
      sources: [],
      formats: [],
      tasks: [],
      languages: [],
      licenses: [],
      modalities: [],
      sizes: [],
      updated: [],
    });
  };

  const clearSearch = () => {
    setQuery("");
    setSubmittedQuery("");
  };

  const runDeepSearch = async () => {
    const activeQuery = submittedQuery.trim() || query.trim();
    if (!activeQuery) {
      return;
    }

    setIsDeepLoading(true);
    setDeepError("");

    try {
      const response = await fetch(`/api/deep-search?q=${encodeURIComponent(activeQuery)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to run Deep Search.");
      }

      setDeepResults(data.results || []);
      setDeepSources(data.sources || []);
      setDeepTotal(data.total || 0);
    } catch (requestError) {
      setDeepResults([]);
      setDeepSources([]);
      setDeepTotal(0);
      setDeepError(requestError.message || "Unable to run Deep Search.");
    } finally {
      setIsDeepLoading(false);
    }
  };

  const shouldSuggestDeepSearch = submittedQuery && !isLoading && !error && results.length <= 3;

  return (
    <div className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="hero">
        <nav className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">DS</span>
            <div>
              <strong>Dataset Search Engine</strong>
              <p>Multi-source dataset discovery</p>
            </div>
          </div>
          <div className="topbar-stats">
            <span>{sourceStats.length} connected sources</span>
            <span>{totalResults} discoverable datasets</span>
          </div>
        </nav>

        <div className="hero-grid">
          <section className="hero-copy">
            <span className="eyebrow">Data discovery, redesigned</span>
            <h1>Find the right dataset faster.</h1>
            <p>
              Search across Hugging Face, UCI, Kaggle, Data.gov, and GitHub with
              weighted relevance, clean metadata, and filters built for real
              research workflows.
            </p>

            <form className="search-panel" onSubmit={handleSubmit}>
              <label className="search-bar">
                <span className="search-icon" aria-hidden="true">
                  <SearchIcon />
                </span>
                <input
                  aria-label="Search datasets"
                  placeholder="Try 'fresh vs rotten fruits' or 'mental health csv'"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <button type="button" className="clear-button" onClick={clearSearch}>
                    Clear
                  </button>
                ) : null}
              </label>
              <button type="submit" className="primary-button">
                Search datasets
              </button>
            </form>

            <div className="featured-queries">
              {FEATURED_QUERIES.map((item) => (
                <button key={item} type="button" onClick={() => handleFeaturedQuery(item)}>
                  {item}
                </button>
              ))}
            </div>
          </section>

          <aside className="hero-card">
            <span className="hero-card-label">Search quality</span>
            <h2>Weighted ranking tuned for dataset intent</h2>
            <ul>
              <li>Title matches get the highest boost.</li>
              <li>Tags and task types help niche queries surface faster.</li>
              <li>Descriptions add long-tail context without overpowering relevance.</li>
            </ul>
          </aside>
        </div>
      </header>

      <main className="results-layout">
        <aside className="filters-panel">
          <div className="filters-header">
            <div>
              <span className="eyebrow">Refine</span>
              <h2>Filters</h2>
            </div>
            <button type="button" className="text-button" onClick={clearFilters}>
              Reset
            </button>
          </div>

          <ToggleGroup
            title="Sources"
            items={sourceItems}
            selected={filters.sources}
            onToggle={(value) => toggleFilter("sources", value)}
          />
          <ToggleGroup
            title="Formats"
            items={formatItems}
            selected={filters.formats}
            onToggle={(value) => toggleFilter("formats", value)}
          />
          <ToggleGroup
            title="Task Types"
            items={taskItems}
            selected={filters.tasks}
            onToggle={(value) => toggleFilter("tasks", value)}
          />
          <ToggleGroup
            title="Languages"
            items={languageItems}
            selected={filters.languages}
            onToggle={(value) => toggleFilter("languages", value)}
          />
          <ToggleGroup
            title="Licenses"
            items={licenseItems}
            selected={filters.licenses}
            onToggle={(value) => toggleFilter("licenses", value)}
          />
          <ToggleGroup
            title="Modalities"
            items={modalityItems}
            selected={filters.modalities}
            onToggle={(value) => toggleFilter("modalities", value)}
          />
          <ToggleGroup
            title="Size"
            items={sizeItems}
            selected={filters.sizes}
            onToggle={(value) => toggleFilter("sizes", value)}
          />
          <ToggleGroup
            title="Freshness"
            items={updatedItems}
            selected={filters.updated}
            onToggle={(value) => toggleFilter("updated", value)}
          />
        </aside>

        <section className="results-panel">
          <div className="results-toolbar">
            <div>
              <span className="eyebrow">Indexed Results</span>
              <h2>
                {submittedQuery ? `Showing matches for "${submittedQuery}"` : "Explore datasets"}
              </h2>
              <p>{totalResults} results available</p>
            </div>
            <div className="inline-stats">
              {sourceStats.map((source) => (
                <div key={source.source} className="stat-card">
                  <strong>{source.count}</strong>
                  <span>{formatLabel(source.source)}</span>
                </div>
              ))}
            </div>
          </div>

          {error ? (
            <div className="state-card error-state">
              <h3>Couldn't load datasets</h3>
              <p>{error}</p>
            </div>
          ) : null}

          {isLoading ? (
            <div className="state-card loading-state">
              <div className="loader" />
              <h3>Searching the catalog</h3>
              <p>Ranking datasets, preparing filters, and loading fresh results.</p>
            </div>
          ) : null}

          {!isLoading && !error && results.length === 0 ? (
            <div className="state-card empty-state">
              <h3>No datasets found</h3>
              <p>Try a broader term, remove a filter, or explore one of the suggested searches.</p>
            </div>
          ) : null}

          {!isLoading && !error && results.length > 0 ? (
            <div className="results-grid">
              {results.map((dataset) => (
                <ResultCard key={`${dataset.source}-${dataset.id}`} dataset={dataset} />
              ))}
            </div>
          ) : null}

          <section className="deep-search-panel">
            <div className="deep-search-copy">
              <span className="eyebrow">Live Deep Search</span>
              <h3>Can't find what you need?</h3>
              <p>
                Search live dataset sources for fresh results beyond the local index.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={runDeepSearch}
              disabled={isDeepLoading || (!submittedQuery.trim() && !query.trim())}
            >
              {isDeepLoading ? "Searching live sources..." : "Deep Search More Datasets"}
            </button>
          </section>

          {shouldSuggestDeepSearch ? (
            <div className="deep-search-tip">
              Indexed results look a bit thin for this query. Try Deep Search for broader live coverage.
            </div>
          ) : null}

          {deepError ? (
            <div className="state-card error-state">
              <h3>Deep Search couldn't finish</h3>
              <p>{deepError}</p>
            </div>
          ) : null}

          {isDeepLoading ? (
            <div className="state-card loading-state">
              <div className="loader" />
              <h3>Searching live sources...</h3>
              <p>Checking Hugging Face, Kaggle, GitHub, UCI, and open data portals.</p>
            </div>
          ) : null}

          {!isDeepLoading && deepResults.length > 0 ? (
            <section className="deep-results-section">
              <div className="results-toolbar">
                <div>
                  <span className="eyebrow">Live Deep Search Results</span>
                  <h2>{deepTotal} live results found</h2>
                  <p>Temporary results from live source queries. They are not added to your local index.</p>
                </div>
                <div className="deep-source-status">
                  {deepSources.map((source) => (
                    <span key={source.source} className={`deep-source-pill ${source.ok ? "ok" : "error"}`}>
                      {formatLabel(source.source)} {source.ok ? `(${source.count})` : "(failed)"}
                    </span>
                  ))}
                </div>
              </div>

              <div className="results-grid">
                {deepResults.map((dataset) => (
                  <ResultCard key={`deep-${dataset.source}-${dataset.id}`} dataset={dataset} />
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </main>
    </div>
  );
}

export default App;
