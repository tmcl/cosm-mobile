import * as moo from "ts-xml-object-parser"
import * as xmldom from "xmldom"

export function getApi06PermissionsXml(): Promise<OsmStandard & InaRecord_permissions_Permission> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "text/xml"}
  };

  let params = {};
  return ( window.fetch)(`https://openstreetmap.org/api/0.6/permissions` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
    return new Promise((resolve, reject) => {
      if (response.status !== 200) {
        return response.text().then((text) => reject({text, status: response.status}));
      } else {
        return response.text().then((xml) => {
          console.log(xml)
          try {
            const doc = new xmldom.DOMParser().parseFromString(xml)
          //console.log(jsdom1)
          //const dom = jsdom1.window
          //console.log(dom)
          console.log(1)
            //const root = dom.document
            console.log(doc)
          const parseResult = moo.parseRoot('osm', parseOsmStandardAndPermissions)(doc)
          console.log(2)
          if("success" in parseResult) {
            console.log(3)
            resolve(parseResult.success)
            console.log(4)
          }
          else { console.log(5)
            reject(parseResult)
          console.log(6) }
          console.log(7)
          } catch (e) {
            console.log(8)
            console.log(e)
            console.log(9)
            reject(e)
          }
        });
      }
    });
  });
}

const asPermission = (string: string): moo.Result<Permission>  => {
  switch (string) {

    case "allow_read_prefs" :
    case  "allow_write_prefs" :
    case  "allow_write_diary" :
    case  "allow_write_api" :
    case  "allow_write_redactions" :
    case  "allow_read_gpx" :
    case  "allow_write_gpx" :
    case  "allow_write_notes":
      return {success: string}
    default:
      return {error: `value error`, message: `unknown ${string}`}
  }
}

const ParsePermissionString: moo.Parser<Permission> = (nodes) => {
  console.log("from parse permission string", nodes)
  const r = moo.parseString(nodes)

  if ("success" in r) {
    return asPermission(r.success)
  } else {
    return r
  }
}
const ParsePermissionName: moo.Parser<Permission> = moo.parseInline({type: "attribute", xmlname: "name", parser: ParsePermissionString})

const ParseOsmStandardAndPermissions: moo.ParserObject<OsmStandard & InaRecord_permissions_Permission> = {
  permissions: {type:"element", xmlname: "permissions", parser: moo.parseInline({ type: "element", xmlname: "permission", parser: moo.parseArray<Permission>(ParsePermissionName) })},

  version: {type:"attribute", if_absent: "optional key", parser: moo.parseString},
  generator: {type:"attribute", if_absent: "optional key", parser: moo.parseString},
  copyright: {type:"attribute", if_absent: "optional key", parser: moo.parseString},
  attribution: {type:"attribute", if_absent: "optional key", parser: moo.parseString},
  license: {type:"attribute", if_absent: "optional key", parser: moo.parseString},
}

const parseOsmStandardAndPermissions: moo.Parser<OsmStandard & InaRecord_permissions_Permission> = moo.parseObject(ParseOsmStandardAndPermissions)

export function getApi06CapabilitiesText(): Promise<string> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "text/xml"}
  };
  
  let params = {};
  return ( window.fetch)(`localhost/api/0.6/capabilities` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
    return new Promise((resolve, reject) => {
      if (response.status !== 200) {
        return response.text().then((text) => reject({text, status: response.status}));
      } else {
        return response.text().then((text) => resolve(text));
      }
    });
  });
}

export function getApiVersionsText(): Promise<string> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "GET",
    headers: {"Accept": "text/xml"}
  };
  
  let params = {};
  return ( window.fetch)(`localhost/api/versions` + "?" + new URLSearchParams(params).toString(), options).then((response) => {
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
  policy: InaRecord_imagery_InaRecord_blacklist_InaRecord_regex_string;
}

export interface IApiCapabilitiesApi {
  version: Range;
  area: InaRecord_maximum_number;
  note_area: InaRecord_maximum_number;
  tracepoints: InaRecord_per_page_number;
  waynodes: InaRecord_maximum_number;
  relationmembers: InaRecord_maximum_number;
  changesets: ChangeSetCapabilities;
  notes: NotesCapabilities;
  timeout: InaRecord_seconds_number;
  status: Stati;
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

export interface IInaRecord_api {
  api: InaRecord_versions_ApiVersion;
}

export interface IInaRecord_blacklist {
  blacklist: InaRecord_regex_string[];
}

export interface IInaRecord_imagery {
  imagery: InaRecord_blacklist_InaRecord_regex_string;
}

export interface IInaRecord_maximum {
  maximum: number;
}

export interface IInaRecord_per_page {
  per_page: number;
}

export interface IInaRecord_permissions {
  permissions: Permission[];
}

export interface IInaRecord_regex {
  regex: string;
}

export interface IInaRecord_seconds {
  seconds: number;
}

export interface IInaRecord_versions {
  versions: ApiVersion[];
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

export interface IOsmBasic {
  value: CreateChangeset;
}

export interface IOsmStandard {
  version?: string;
  generator?: string;
  copyright?: string;
  attribution?: string;
  license?: string;
}

export interface IRange {
  minimum: ApiVersion;
  maximum: ApiVersion;
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

export type ApiVersion = "0.6";

export type Bbox = IBbox;

export type BoundedElements = IBoundedElements;

export type ChangeSetCapabilities = IChangeSetCapabilities;

export type Changeset = IChangeset;

export type CreateChangeset = ICreateChangeset;

export type Element = INode | IWay | IRelation;

export type IChangeset = {[k in string]?: string};

export type ICreateChangeset = Changeset;

export type InaRecord_api_InaRecord_versions_ApiVersion = IInaRecord_api;

export type InaRecord_blacklist_InaRecord_regex_string = IInaRecord_blacklist;

export type InaRecord_imagery_InaRecord_blacklist_InaRecord_regex_string = IInaRecord_imagery;

export type InaRecord_maximum_number = IInaRecord_maximum;

export type InaRecord_per_page_number = IInaRecord_per_page;

export type InaRecord_permissions_Permission = IInaRecord_permissions;

export type InaRecord_regex_string = IInaRecord_regex;

export type InaRecord_seconds_number = IInaRecord_seconds;

export type InaRecord_versions_ApiVersion = IInaRecord_versions;

export type NotesCapabilities = INotesCapabilities;

export type OsmBasic = {"osm": IOsmBasic};

export type OsmStandard = IOsmStandard;

export type Permission = "allow_read_prefs" | "allow_write_prefs" | "allow_write_diary" | "allow_write_api" | "allow_write_redactions" | "allow_read_gpx" | "allow_write_gpx" | "allow_write_notes";

export type Range = IRange;

export type RelationMember = IRmWay | IRmNode | IRmRelation;

export type Stati = IStati;

export type Status = "offline" | "readonly" | "online";
export function toQueryParamOsmBasic(a : OsmBasic) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardApiCapabilities(a : OsmStandard & ApiCapabilities) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardBoundedElements(a : OsmStandard & BoundedElements) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardInaRecordapiInaRecordversionsApiVersion(a : OsmStandard & InaRecord_api_InaRecord_versions_ApiVersion) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardInaRecordpermissionsPermission(a : OsmStandard & InaRecord_permissions_Permission) { return (((a) => a))(a) } 
export function toQueryParamBbox(a : Bbox) { return ((a) => `${a.minlon},${a.minlat},${a.maxlon},${a.maxlat}`)(a) } 

