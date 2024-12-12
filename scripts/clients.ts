export function getApi06Map(bbox?: Bbox, fetchFn?: (input: RequestInfo, init?: RequestInit) => Promise<Response>): Promise<OsmStandard & BoundedElements> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "application/json;charset=utf-8"}
  };
  
  let params: {bbox?: string} = {}
  bbox && (params.bbox = toQueryParamBbox(bbox));

  return (fetchFn || window.fetch)(`https://openstreetmap.org/api/0.6/map` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
    return new Promise((resolve, reject) => {
      if (response.status !== 200) {
        return response.text().then((text) => reject({text, status: response.status}));
      } else {
        return response.json().then((json) => resolve(json));
      }
    });
  });
}

export async function getApi06MapText(bbox?: Bbox, fetchFn?: (input: RequestInfo, init?: RequestInit) => Promise<Response>): Promise<string> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "application/json;charset=utf-8"}
  };
  
  let params: {bbox?: string} = {}
  bbox && (params.bbox = toQueryParamBbox(bbox));

	let url = `https://openstreetmap.org/api/0.6/map` + "?" + new URLSearchParams(params).toString()
		console.log(url, "query url")
	try {
	const response = await (fetchFn || window.fetch)(url, options)
		if (response.status !== 200) {
			const text = await response.text()
			console.log({text, status: response.status}, "error")
			throw ({text, status: response.status});
		} else {
			return await response.text()
		}
	} catch (e) {
		console.log(e, "error")
		throw e
	}
}

export function getApi06Capabilities(fetchFn?: (input: RequestInfo, init?: RequestInit) => Promise<Response>): Promise<OsmStandard & ApiCapabilities> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "application/json;charset=utf-8"}
  };
  
  let params = {};
  return (fetchFn || window.fetch)(`https://openstreetmap.org/api/0.6/capabilities` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
    return new Promise((resolve, reject) => {
      if (response.status !== 200) {
        return response.text().then((text) => reject({text, status: response.status}));
      } else {
        return response.json().then((json) => resolve(json));
      }
    });
  });
}

export function getApi06CapabilitiesText(fetchFn?: (input: RequestInfo, init?: RequestInit) => Promise<Response>): Promise<string> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "application/json;charset=utf-8"}
  };
  
  let params = {};
  return (fetchFn || window.fetch)(`https://openstreetmap.org/api/0.6/capabilities` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
    return new Promise((resolve, reject) => {
      if (response.status !== 200) {
        return response.text().then((text) => reject({text, status: response.status}));
      } else {
        return response.text().then((text) => resolve(text));
      }
    });
  });
}

export function getApiVersions(fetchFn?: (input: RequestInfo, init?: RequestInit) => Promise<Response>): Promise<OsmStandard & JSONApiVersions> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "application/json;charset=utf-8"}
  };
  
  let params = {};
  return (fetchFn || window.fetch)(`https://openstreetmap.org/api/versions` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
    return new Promise((resolve, reject) => {
      if (response.status !== 200) {
        return response.text().then((text) => reject({text, status: response.status}));
      } else {
        return response.json().then((json) => resolve(json));
      }
    });
  });
}

export function getApiVersionsText(fetchFn?: (input: RequestInfo, init?: RequestInit) => Promise<Response>): Promise<string> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "application/json;charset=utf-8"}
  };
  
  let params = {};
  return (fetchFn || window.fetch)(`https://openstreetmap.org/api/versions` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
    return new Promise((resolve, reject) => {
      if (response.status !== 200) {
        return response.text().then((text) => reject({text, status: response.status}));
      } else {
        return response.text().then((text) => resolve(text));
      }
    });
  });
}
export interface IApiCapabilities {
  api: ApiCapabilitiesApi;
  policy: ApiCapabilitiesPolicyBlacklist1;
}

export interface IApiCapabilitiesApi {
  version: Range<ApiVersion>;
  area: Maximum<number>;
  note_area: Maximum<number>;
  tracepoints: PerPage<number>;
  waynodes: Maximum<number>;
  relationmembers: Maximum<number>;
  changesets: ChangeSetCapabilities;
  notes: NotesCapabilities;
  timeout: Seconds<number>;
  status: Stati;
}

export interface IApiCapabilitiesPolicyBlacklist1 {
  imagery: ApiCapabilitiesPolicyBlacklist2;
}

export interface IApiCapabilitiesPolicyBlacklist2 {
  blacklist: RegexText[];
}

export interface IBbox {
  minlon: number;
  minlat: number;
  maxlon: number;
  maxlat: number;
}

export interface IBoundedElements {
  bounds: Bbox;
  elements: Element[];
}

export interface IChangeSetCapabilities {
  maximum_elements: number;
  default_query_limit: number;
  maximum_query_limit: number;
}

export interface IJSONApiVersions {
  api: JSONApiVersions1;
}

export interface IJSONApiVersions1 {
  versions: ApiVersion[];
}

export interface IMaximum<T> {
  maximum: T;
}

export interface INode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  timestamp: string;
  version: number;
  changeset: number;
  user: string;
  uid: number;
  tags?: {[k in string]?: string};
}

export interface INotesCapabilities {
  default_query_limit: number;
  maximum_query_limit: number;
}

export interface IOsmStandard {
  version: string | null;
  generator: string | null;
  copyright: string | null;
  attribution: string | null;
  license: string | null;
}

export interface IPerPage<T> {
  per_page: T;
}

export interface IRange<T> {
  minimum: T;
  maximum: T;
}

export interface IRelation {
  type: "relation";
  id: number;
  members: RelationMember[];
  timestamp: string;
  version: number;
  changeset: number;
  user: string;
  uid: number;
  tags?: {[k in string]?: string};
}

export interface IRmNode {
  type: "node";
  ref: number;
  role: string;
}

export interface IRmRelation {
  type: "relation";
  ref: number;
  role: string;
}

export interface IRmWay {
  type: "way";
  ref: number;
  role: string;
}

export interface ISeconds<T> {
  seconds: T;
}

export interface IStati {
  database: Status;
  api: Status;
  gpx: Status;
}

export interface IWay {
  type: "way";
  id: number;
  nodes: number[];
  timestamp: string;
  version: number;
  changeset: number;
  user: string;
  uid: number;
  tags?: {[k in string]?: string};
}

export type ApiCapabilities = IApiCapabilities;

export type ApiCapabilitiesApi = IApiCapabilitiesApi;

export type ApiCapabilitiesPolicyBlacklist1 = IApiCapabilitiesPolicyBlacklist1;

export type ApiCapabilitiesPolicyBlacklist2 = IApiCapabilitiesPolicyBlacklist2;

export type ApiVersion = "0.6" | "0.6";

export type Bbox = IBbox;

export type BoundedElements = IBoundedElements;

export type ChangeSetCapabilities = IChangeSetCapabilities;

export type Element = INode | IWay | IRelation;

export type IRegexText = string;

export type JSONApiVersions = IJSONApiVersions;

export type JSONApiVersions1 = IJSONApiVersions1;

export type Maximum<T> = IMaximum<T>;

export type NotesCapabilities = INotesCapabilities;

export type OsmStandard = IOsmStandard;

export type PerPage<T> = IPerPage<T>;

export type Range<T> = IRange<T>;

export type RegexText = IRegexText;

export type RelationMember = IRmWay | IRmNode | IRmRelation;

export type Seconds<T> = ISeconds<T>;

export type Stati = IStati;

export type Status = "offline" | "readonly" | "online";
export function toQueryParamOsmStandardApiCapabilities(a : OsmStandard & ApiCapabilities) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardBoundedElements(a : OsmStandard & BoundedElements) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardJSONApiVersions(a : OsmStandard & JSONApiVersions) { return (((a) => a))(a) } 
export function toQueryParamBbox(a : Bbox) { return ((a) => `${a.minlon},${a.minlat},${a.maxlon},${a.maxlat}`)(a) } 

