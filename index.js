const OWNER = "RuleWorld";
const REPO = "RuleHub";
const BRANCH = "master";

const ROOTS = [
  { folder: "Published", type: "Published" },
  { folder: "Examples", type: "Examples" },
  { folder: "Tutorials", type: "Tutorials" }
];

const TREE_API =
  `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;

const RAW_BASE =
  `https://raw.githubusercontent.com/${OWNER}/${REPO}/refs/heads/${BRANCH}/`;

const GITHUB_BLOB_BASE =
  `https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/`;

const BNGLVIZ_PAGE =
  "https://bnglviz.github.io/bngl_bnglviz.html";

const RULES_RAILROAD_PAGE =
  "https://rulesrailroad.github.io/bngl_rrr.html";

const BNG_PLAYGROUND_PAGE =
  "https://ruleworld.github.io/bngplayground/";

const DEFAULT_VISIBLE_COLUMNS = [
  "type",
  "name",
  "description",
  "bnglviz",
  "rules_railroad",
  "bngplayground"
];

const FEATURE_FILTER_COLUMNS = new Set([
  "compatibility.nfsim_compatible",
  "compatibility.bng2_compatible",
  "compatibility.uses_compartments",
  "compatibility.uses_energy",
  "compatibility.uses_functions"
]);

const COMMENTED_OUT_COLUMN_CHECKBOXES = new Set([
  "file",
  "path",
  "id",
  "bngl_code",
  "bngl_file",
  "bngl_path",
  "yaml_file",
  "yaml_path",
  "github",
  "bngl_item",
  "yaml_github",
  "source.source_path",
  "source.origin",
  "playground.visible",
  "playground.featured",
  "playground.gallery_category",
  "playground.gallery_categories",
  "contributors",
  "parse_error",
  "collection.count",
  "collection.parent_model",
  "collection.type",
  "collection.variant_key",
  "source.original_format",
  "source.original_repository",
  "raw"
]);

const HIDDEN_COLUMN_CHECKBOXES = new Set([
  "playground.difficulty",
  "difficulty",
  ...FEATURE_FILTER_COLUMNS,
  ...COMMENTED_OUT_COLUMN_CHECKBOXES
]);

const NON_SORTABLE_COLUMNS = new Set([
  "bngl_code",
  "bnglviz",
  "rules_railroad",
  "bngplayground",
  "github",
  "github_link",
  "raw"
]);

const COLUMN_LABELS = {
  "type": "Type",
  "name": "Name",
  "description": "Description",
  "bngl_code": "BNGL code",
  "bnglviz": "bnglViz",
  "rules_railroad": "RulesRailRoad",
  "bngplayground": "bngPlayground",
  "github": "GitHub",
  "github_link": "GitHub",
  "compatibility.simulation_methods": "simulation methods"
};

let table;
let statusEl;
let searchEl;
let columnCheckboxesEl;
let pageSizeEl;
let pageSummaryEl;
let pageNumberEl;
let firstPageBtn;
let prevPageBtn;
let nextPageBtn;
let lastPageBtn;

let rows = [];
let columns = [];
let visibleColumns = new Set(DEFAULT_VISIBLE_COLUMNS);
let sortState = { column: null, direction: 1 };
let currentPage = 1;

function pathRoot(path) {
  return ROOTS.find(item => path === item.folder || path.startsWith(`${item.folder}/`)) || null;
}

function typeFromPath(path) {
  const root = pathRoot(path);
  return root ? root.type : "";
}

function isInTargetRoot(path) {
  return Boolean(pathRoot(path));
}

function isYamlPath(path) {
  return isInTargetRoot(path) && (path.endsWith(".yaml") || path.endsWith(".yml"));
}

function isBnglPath(path) {
  return isInTargetRoot(path) && path.endsWith(".bngl");
}

function dirname(path) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function basename(path) {
  return path.split("/").pop();
}

function flattenObject(value, prefix = "", output = {}) {
  if (Array.isArray(value)) {
    output[prefix] = value.map(item => {
      if (item && typeof item === "object") return JSON.stringify(item);
      return String(item);
    }).join("; ");
    return output;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenObject(nestedValue, nextPrefix, output);
    }
    return output;
  }

  output[prefix] = value == null ? "" : String(value);
  return output;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "Accept": "application/vnd.github+json" }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

function getColumnLabel(column) {
  return COLUMN_LABELS[column] || column;
}

function normalizeDifficulty(value) {
  const text = String(value ?? "").trim().toLowerCase();

  if (text.includes("beginner") || text === "easy" || text === "introductory") return "beginner";
  if (text.includes("intermediate") || text === "medium") return "intermediate";
  if (text.includes("advanced") || text === "hard") return "advanced";

  return "";
}

function getRowDifficulty(row) {
  return normalizeDifficulty(
    row["playground.difficulty"] ||
    row["difficulty"] ||
    row["level"]
  );
}

function getSelectedDifficulties() {
  return new Set(
    [...document.querySelectorAll(".difficulty-checkbox:checked")]
      .map(input => input.value)
  );
}

function getSelectedTypes() {
  return new Set(
    [...document.querySelectorAll(".type-checkbox:checked")]
      .map(input => input.value)
  );
}

function rowMatchesType(row) {
  const selected = getSelectedTypes();

  if (!row.type) {
    return selected.size > 0;
  }

  return selected.has(row.type);
}

function getSelectedFeatureFilters() {
  return [...document.querySelectorAll(".feature-checkbox:checked")]
    .map(input => input.value);
}

function isTruthyYamlValue(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}

function makeBnglVizUrl(item) {
  const url = new URL(BNGLVIZ_PAGE);
  url.searchParams.set("bngl", item.rawUrl);
  url.searchParams.set("label", item.label);
  url.searchParams.set("github", item.githubUrl);
  return url.toString();
}

function makeRulesRailRoadUrl(item) {
  const url = new URL(RULES_RAILROAD_PAGE);
  url.searchParams.set("bngl", item.rawUrl);
  url.searchParams.set("label", item.label);
  url.searchParams.set("github", item.githubUrl);
  return url.toString();
}

function makeBngPlaygroundUrl(item) {
  const url = new URL(BNG_PLAYGROUND_PAGE);
  url.searchParams.set("model", item.path);
  return url.toString();
}

function makeBnglItems(yamlPath, bnglPaths) {
  const yamlDir = dirname(yamlPath);
  const matchingBngl = bnglPaths.filter(path => dirname(path) === yamlDir);

  return matchingBngl.map(path => {
    const item = {
      path,
      label: basename(path),
      rawUrl: RAW_BASE + path,
      githubUrl: GITHUB_BLOB_BASE + path
    };

    item.bnglVizUrl = makeBnglVizUrl(item);
    item.rulesRailRoadUrl = makeRulesRailRoadUrl(item);
    item.bngPlaygroundUrl = makeBngPlaygroundUrl(item);

    return item;
  });
}

async function loadYamlFile(path, bnglPaths) {
  const rawUrl = RAW_BASE + path;
  const yamlGitHubUrl = GITHUB_BLOB_BASE + path;
  const readmeUrl = GITHUB_BLOB_BASE + dirname(path) + "/README.md";
  const bnglItems = makeBnglItems(path, bnglPaths);

  try {
    const text = await fetchText(rawUrl);
    const parsed = jsyaml.load(text) || {};
    const flat = flattenObject(parsed);

    if (bnglItems.length === 0) {
      return [{
        type: typeFromPath(path),
        file: basename(path),
        path,
        yaml_file: basename(path),
        yaml_path: path,
        github: readmeUrl,
        github_link: readmeUrl,
        yaml_github: yamlGitHubUrl,
        raw: rawUrl,
        bngl_item: null,
        bnglviz: null,
        rules_railroad: null,
        bngplayground: null,
        ...flat
      }];
    }

    return bnglItems.map(item => ({
      type: typeFromPath(path),
      file: basename(path),
      path,
      yaml_file: basename(path),
      yaml_path: path,
      bngl_file: item.label,
      bngl_path: item.path,
      github: readmeUrl,
      github_link: readmeUrl,
      yaml_github: yamlGitHubUrl,
      raw: rawUrl,
      bngl_item: item,
      bnglviz: item,
      rules_railroad: item,
      bngplayground: item,
      ...flat
    }));
  } catch (error) {
    if (bnglItems.length === 0) {
      return [{
        type: typeFromPath(path),
        file: basename(path),
        path,
        yaml_file: basename(path),
        yaml_path: path,
        github: readmeUrl,
        github_link: readmeUrl,
        yaml_github: yamlGitHubUrl,
        raw: rawUrl,
        bngl_item: null,
        bnglviz: null,
        rules_railroad: null,
        bngplayground: null,
        parse_error: error.message
      }];
    }

    return bnglItems.map(item => ({
      type: typeFromPath(path),
      file: basename(path),
      path,
      yaml_file: basename(path),
      yaml_path: path,
      bngl_file: item.label,
      bngl_path: item.path,
      github: readmeUrl,
      github_link: readmeUrl,
      yaml_github: yamlGitHubUrl,
      raw: rawUrl,
      bngl_item: item,
      bnglviz: item,
      rules_railroad: item,
      bngplayground: item,
      parse_error: error.message
    }));
  }
}

async function loadAllMetadata() {
  statusEl.textContent = "Fetching repository tree from GitHub...";
  table.innerHTML = "";
  columnCheckboxesEl.innerHTML = "";

  const treeData = await fetchJson(TREE_API);

  if (treeData.truncated) {
    console.warn("GitHub returned a truncated tree. Some files may be missing.");
  }

  const allPaths = treeData.tree
    .filter(item => item.type === "blob")
    .map(item => item.path)
    .sort();

  const yamlPaths = allPaths.filter(isYamlPath);
  const bnglPaths = allPaths.filter(isBnglPath);

  statusEl.textContent =
    `Found ${yamlPaths.length} YAML file(s) and ${bnglPaths.length} BNGL file(s). Loading metadata...`;

  const rowGroups = await Promise.all(
    yamlPaths.map(path => loadYamlFile(path, bnglPaths))
  );

  rows = rowGroups.flat();

  const allColumnNames = new Set();
  rows.forEach(row => Object.keys(row).forEach(key => allColumnNames.add(key)));

  const preferred = [
    "type",
    "name",
    "description",
    "bnglviz",
    "rules_railroad",
    "bngplayground",
    "github_link",
    "github",
    "bngl_item",
    "yaml_github",
    "bngl_file",
    "bngl_path",
    "yaml_file",
    "yaml_path",
    "file",
    "path",
    "id",
    "authors",
    "contributors",
    "citation.doi",
    "citation.pmid",
    "citation.reference",
    "date.created",
    "date.modified",
    "date.published",
    "tags",
    "category",
    "compatibility.min_bng_version",
    "compatibility.simulation_methods",
    "source.origin",
    "source.source_path",
    "playground.visible",
    "playground.gallery_category",
    "playground.gallery_categories",
    "playground.featured",
    "raw",
    "parse_error"
  ];

  columns = [
    ...preferred.filter(column =>
      (
        allColumnNames.has(column) ||
        column === "type" ||
        column === "bnglviz" ||
        column === "rules_railroad" ||
        column === "bngplayground" ||
        column === "github_link"
      ) &&
      !HIDDEN_COLUMN_CHECKBOXES.has(column)
    ),
    ...[...allColumnNames]
      .filter(column => !preferred.includes(column))
      .filter(column => !HIDDEN_COLUMN_CHECKBOXES.has(column))
      .sort()
  ];

  visibleColumns = new Set(
    DEFAULT_VISIBLE_COLUMNS.filter(column => columns.includes(column))
  );

  if (sortState.column && NON_SORTABLE_COLUMNS.has(sortState.column)) {
    sortState = { column: null, direction: 1 };
  }

  currentPage = 1;
  renderColumnCheckboxes();
  renderTable();
  updateStatus();
}

function renderColumnCheckboxes() {
  columnCheckboxesEl.innerHTML = columns.map(column => {
    const checked = visibleColumns.has(column) ? "checked" : "";
    const label = getColumnLabel(column);

    return `
      <label>
        <input type="checkbox" value="${escapeHtml(column)}" ${checked}>
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }).join("");

  columnCheckboxesEl.querySelectorAll("input[type='checkbox']").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) visibleColumns.add(input.value);
      else visibleColumns.delete(input.value);

      currentPage = 1;
      renderTable();
      updateStatus();
    });
  });
}

function renderSingleViewLink(item, urlKey) {
  if (!item || !item[urlKey]) return "";

  return `<a href="${escapeHtml(item[urlKey])}" target="_blank" rel="noopener" title="${escapeHtml(item.label)}">view</a>`;
}

function renderCell(column, value, row) {
  if (column === "github_link") {
    if (!value) return "";
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener">view</a>`;
  }

  if (column === "github") {
    if (!value) return "";
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener">view</a>`;
  }

  if (column === "raw") {
    if (!value) return "";
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener">link</a>`;
  }

  if (column === "type") {
    return `<span class="type-badge">${escapeHtml(value)}</span>`;
  }

  if (column === "description") {
    if (!value) return "";
    if (row.raw) {
      return `<a href="${escapeHtml(row.raw)}" target="_blank" rel="noopener">${escapeHtml(value)}</a> <img src="icons/einstein-equation.svg" width="28" alt="Energy"> <img src="icons/functions.svg" width="28" alt="Functions">`;
    }
    return escapeHtml(value);
  }

  if (column === "bnglviz") {
    return renderSingleViewLink(value, "bnglVizUrl");
  }

  if (column === "rules_railroad") {
    return renderSingleViewLink(value, "rulesRailRoadUrl");
  }

  if (column === "bngplayground") {
    return renderSingleViewLink(value, "bngPlaygroundUrl");
  }

  if (column === "name") {
    const difficulty = getRowDifficulty(row);
    const className = difficulty ? `difficulty-${difficulty}` : "";
    const label = value || row.bngl_file || row.file || "";
    const title = difficulty || "difficulty not specified";

    if (row.bngl_item && row.bngl_item.rawUrl) {
      return `
        <a
          class="model-name model-name-link ${className}"
          href="${escapeHtml(row.bngl_item.rawUrl)}"
          target="_blank"
          rel="noopener"
          title="${escapeHtml(title)}"
        >
          ${escapeHtml(label)}
        </a>
      `;
    }

    return `
      <span class="model-name ${className}" title="${escapeHtml(title)}">
        ${escapeHtml(label)}
      </span>
    `;
  }

  return escapeHtml(value);
}

function searchableText(value) {
  if (Array.isArray(value)) return value.map(item => searchableText(item)).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(item => searchableText(item)).join(" ");
  return String(value ?? "");
}

function rowMatchesSearch(row, query) {
  if (!query) return true;

  return Object.values(row).some(value =>
    searchableText(value).toLowerCase().includes(query)
  );
}

function rowMatchesDifficulty(row) {
  const selected = getSelectedDifficulties();
  const difficulty = getRowDifficulty(row);

  if (!difficulty) return selected.size > 0;
  return selected.has(difficulty);
}

function rowMatchesFeatureFilters(row) {
  const selectedFeatureFilters = getSelectedFeatureFilters();

  return selectedFeatureFilters.every(column =>
    isTruthyYamlValue(row[column])
  );
}

function valueForSort(row, column) {
  const value = row[column];

  if (
    (column === "bnglviz" ||
     column === "rules_railroad" ||
     column === "bngplayground") &&
    value &&
    typeof value === "object"
  ) {
    return String(value.label ?? "").toLowerCase();
  }

  return String(value ?? "").toLowerCase();
}

function getFilteredSortedRows() {
  const query = searchEl.value.trim().toLowerCase();

  let filteredRows = rows
    .filter(row => rowMatchesSearch(row, query))
    .filter(row => rowMatchesDifficulty(row))
    .filter(row => rowMatchesType(row))
    .filter(row => rowMatchesFeatureFilters(row));

  if (sortState.column && !NON_SORTABLE_COLUMNS.has(sortState.column)) {
    const column = sortState.column;
    const direction = sortState.direction;

    filteredRows = [...filteredRows].sort((a, b) => {
      const av = valueForSort(a, column);
      const bv = valueForSort(b, column);

      return av.localeCompare(bv, undefined, {
        numeric: true,
        sensitivity: "base"
      }) * direction;
    });
  }

  return filteredRows;
}

function getPageSize() {
  const value = pageSizeEl.value;
  return value === "all" ? "all" : Number(value);
}

function getTotalPages(totalRows) {
  const pageSize = getPageSize();
  if (pageSize === "all") return 1;
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

function getPaginatedRows(filteredRows) {
  const pageSize = getPageSize();

  if (pageSize === "all") return filteredRows;

  const totalPages = getTotalPages(filteredRows.length);

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;

  return filteredRows.slice(start, end);
}

function renderTable() {
  const activeColumns = columns.filter(column => visibleColumns.has(column));
  const filteredRows = getFilteredSortedRows();
  const pageRows = getPaginatedRows(filteredRows);

  if (activeColumns.length === 0) {
    table.innerHTML = `
      <tbody>
        <tr>
          <td>No columns selected.</td>
        </tr>
      </tbody>
    `;
    updatePagination(filteredRows.length);
    return;
  }

  const headerHtml = `
    <thead>
      <tr>
        ${activeColumns.map(column => {
          if (NON_SORTABLE_COLUMNS.has(column)) {
            return `
              <th>
                <span class="th-content">
                  <span>${escapeHtml(getColumnLabel(column))}</span>
                </span>
              </th>
            `;
          }

          const isActive = sortState.column === column;
          const icon = isActive
            ? sortState.direction === 1 ? "A→Z" : "Z→A"
            : "↕";

          const title = isActive
            ? sortState.direction === 1
              ? "Sorted ascending. Click for descending."
              : "Sorted descending. Click for ascending."
            : "Sort alphanumerically";

          return `
            <th>
              <span class="th-content">
                <span>${escapeHtml(getColumnLabel(column))}</span>
                <button
                  class="sort-button ${isActive ? "active" : ""}"
                  data-column="${escapeHtml(column)}"
                  title="${escapeHtml(title)}"
                  aria-label="Sort ${escapeHtml(getColumnLabel(column))}"
                >${escapeHtml(icon)}</button>
              </span>
            </th>
          `;
        }).join("")}
      </tr>
    </thead>
  `;

  const bodyHtml = `
    <tbody>
      ${pageRows.map(row => `
        <tr>
          ${activeColumns.map(column =>
            `<td>${renderCell(column, row[column], row)}</td>`
          ).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;

  table.innerHTML = headerHtml + bodyHtml;

  table.querySelectorAll(".sort-button").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const column = button.dataset.column;

      if (NON_SORTABLE_COLUMNS.has(column)) {
        return;
      }

      if (sortState.column === column) {
        sortState.direction *= -1;
      } else {
        sortState = { column, direction: 1 };
      }

      currentPage = 1;
      renderTable();
    });
  });

  updatePagination(filteredRows.length);
}

function updatePagination(totalFilteredRows) {
  const pageSize = getPageSize();
  const totalPages = getTotalPages(totalFilteredRows);

  if (pageSize === "all") currentPage = 1;
  else currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  const start = totalFilteredRows === 0
    ? 0
    : pageSize === "all"
      ? 1
      : (currentPage - 1) * pageSize + 1;

  const end = pageSize === "all"
    ? totalFilteredRows
    : Math.min(currentPage * pageSize, totalFilteredRows);

  pageSummaryEl.textContent =
    `Showing ${start}-${end} of ${totalFilteredRows} matching row(s).`;

  pageNumberEl.textContent =
    pageSize === "all"
      ? "Page 1 of 1"
      : `Page ${currentPage} of ${totalPages}`;

  firstPageBtn.disabled = currentPage <= 1 || pageSize === "all";
  prevPageBtn.disabled = currentPage <= 1 || pageSize === "all";
  nextPageBtn.disabled = currentPage >= totalPages || pageSize === "all";
  lastPageBtn.disabled = currentPage >= totalPages || pageSize === "all";
}

function updateStatus() {
  const typeCounts = rows.reduce((acc, row) => {
    acc[row.type] = (acc[row.type] || 0) + 1;
    return acc;
  }, {});

  const summary = ["Published", "Examples", "Tutorials"]
    .map(type => `${type}: ${typeCounts[type] || 0}`)
    .join("; ");

  statusEl.textContent =
    `Loaded ${rows.length} row(s) from YAML/BNGL file(s). Showing ${visibleColumns.size} column(s). ${summary}.`;
}

function getRowsForCsv() {
  return getFilteredSortedRows();
}

function csvValueForColumn(row, column) {
  if (column === "name" && row.bngl_item) {
    return row.bngl_item.rawUrl;
  }

  if (column === "description" && row.raw) {
    return row.raw;
  }

  if (column === "github_link") {
    return row.github_link || "";
  }

  if (column === "github") {
    return row.github || "";
  }

  if (column === "bnglviz" && row[column]) {
    return row[column].bnglVizUrl || "";
  }

  if (column === "rules_railroad" && row[column]) {
    return row[column].rulesRailRoadUrl || "";
  }

  if (column === "bngplayground" && row[column]) {
    return row[column].bngPlaygroundUrl || "";
  }

  return row[column] ?? "";
}

function downloadCsv() {
  const activeColumns = columns.filter(column => visibleColumns.has(column));
  const csvRows = getRowsForCsv();

  const csv = [
    activeColumns.map(column => csvEscape(getColumnLabel(column))).join(","),
    ...csvRows.map(row =>
      activeColumns
        .map(column => csvEscape(csvValueForColumn(row, column)))
        .join(",")
    )
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "rulehub-models-metadata-visible-columns.csv";
  link.click();

  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function initDomReferences() {
  table = document.getElementById("metadataTable");
  statusEl = document.getElementById("status");
  searchEl = document.getElementById("search");
  columnCheckboxesEl = document.getElementById("columnCheckboxes");

  pageSizeEl = document.getElementById("pageSize");
  pageSummaryEl = document.getElementById("pageSummary");
  pageNumberEl = document.getElementById("pageNumber");

  firstPageBtn = document.getElementById("firstPage");
  prevPageBtn = document.getElementById("prevPage");
  nextPageBtn = document.getElementById("nextPage");
  lastPageBtn = document.getElementById("lastPage");
}

function attachEventListeners() {
  document.getElementById("reload").addEventListener("click", loadAllMetadata);

  document.getElementById("downloadCsv").addEventListener("click", downloadCsv);

  document.getElementById("clearSearch").addEventListener("click", () => {
    searchEl.value = "";
    currentPage = 1;
    renderTable();
  });

  document.getElementById("showDefault").addEventListener("click", () => {
    visibleColumns = new Set(DEFAULT_VISIBLE_COLUMNS.filter(column => columns.includes(column)));
    currentPage = 1;
    renderColumnCheckboxes();
    renderTable();
    updateStatus();
  });

  document.getElementById("showAll").addEventListener("click", () => {
    visibleColumns = new Set(columns);
    currentPage = 1;
    renderColumnCheckboxes();
    renderTable();
    updateStatus();
  });

  document.getElementById("hideAll").addEventListener("click", () => {
    visibleColumns = new Set();
    currentPage = 1;
    renderColumnCheckboxes();
    renderTable();
    updateStatus();
  });

  searchEl.addEventListener("input", () => {
    currentPage = 1;
    renderTable();
  });

  document.querySelectorAll(".difficulty-checkbox").forEach(input => {
    input.addEventListener("change", () => {
      currentPage = 1;
      renderTable();
    });
  });

  document.querySelectorAll(".type-checkbox").forEach(input => {
    input.addEventListener("change", () => {
      currentPage = 1;
      renderTable();
    });
  });

  document.querySelectorAll(".feature-checkbox").forEach(input => {
    input.addEventListener("change", () => {
      currentPage = 1;
      renderTable();
    });
  });

  pageSizeEl.addEventListener("change", () => {
    currentPage = 1;
    renderTable();
  });

  firstPageBtn.addEventListener("click", () => {
    currentPage = 1;
    renderTable();
  });

  prevPageBtn.addEventListener("click", () => {
    currentPage -= 1;
    renderTable();
  });

  nextPageBtn.addEventListener("click", () => {
    currentPage += 1;
    renderTable();
  });

  lastPageBtn.addEventListener("click", () => {
    const totalRows = getFilteredSortedRows().length;
    currentPage = getTotalPages(totalRows);
    renderTable();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initDomReferences();
  attachEventListeners();

  loadAllMetadata().catch(error => {
    console.error(error);
    statusEl.textContent = `Error: ${error.message}`;
  });
});
