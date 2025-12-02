import * as Picklers from "./ts-xml-object-parser"
import {DOMImplementation, XMLSerializer} from "@xmldom/xmldom"

    export function getApi06MapText(bbox?: Bbox): Promise<string> {
      let options: RequestInit = {
        credentials: "same-origin" as RequestCredentials,
        method: "GET",
        headers: {"Accept": "text/xml"}
      };
      
      let params = {bbox: bbox && toQueryParamBbox(bbox)};
      return window.fetch(`https://master.apis.dev.openstreetmap.org/api/0.6/map` + "?" + new URLSearchParams(removeUndefined(params)).toString(), options).then((response) => {
        return new Promise((resolve, reject) => {
          if (response.status !== 200) {
            return response.text().then((text) => reject({text, status: response.status}));
          } else {
            return response.text().then((text) => resolve(text));
          }
        });
      });
    }

    export function putApi06ChangesetCreateText(body: Changeset): Promise<string> {
      let options: RequestInit = {
        credentials: "same-origin" as RequestCredentials,
        method: "PUT",
        headers: {"Accept": "text/xml"}
      };
      
       const doc = new DOMImplementation().createDocument(null, 'osm')

      let params = {};
      console.log(`https://master.apis.dev.openstreetmap.org/api/0.6/changeset/create` + "?" + new URLSearchParams(removeUndefined(params)).toString(), JSON.stringify(options))
      return Promise.reject("unimplemented")
    }

    export function getApi06PermissionsText(): Promise<string> {
      let options: RequestInit = {
        credentials: "same-origin" as RequestCredentials,
        method: "GET",
        headers: {"Accept": "text/xml"}
      };
      
      let params = {};
      return window.fetch(`https://master.apis.dev.openstreetmap.org/api/0.6/permissions` + "?" + new URLSearchParams(removeUndefined(params)).toString(), options).then((response) => {
        return new Promise((resolve, reject) => {
          if (response.status !== 200) {
            return response.text().then((text) => reject({text, status: response.status}));
          } else {
            return response.text().then((text) => resolve(text));
          }
        });
      });
    }

    export function getApi06CapabilitiesText(): Promise<string> {
      let options: RequestInit = {
        credentials: "same-origin" as RequestCredentials,
        method: "GET",
        headers: {"Accept": "text/xml"}
      };
      
      let params = {};
      return window.fetch(`https://master.apis.dev.openstreetmap.org/api/0.6/capabilities` + "?" + new URLSearchParams(removeUndefined(params)).toString(), options).then((response) => {
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
      return window.fetch(`https://master.apis.dev.openstreetmap.org/api/versions` + "?" + new URLSearchParams(removeUndefined(params)).toString(), options).then((response) => {
        return new Promise((resolve, reject) => {
          if (response.status !== 200) {
            return response.text().then((text) => reject({text, status: response.status}));
          } else {
            return response.text().then((text) => resolve(text));
          }
        });
      });
    }
 type FullyDefined<T> = Partial<{
  [key in keyof T]: Exclude<T[key], undefined>
}>

function removeUndefined<T extends object>(t: T): FullyDefined<T> {
  const filter = <K extends keyof T>(arg: [string|number|symbol, T[K]]): arg is [K, Exclude<T[K], undefined>] => arg[1] !== undefined
  return Object.fromEntries(
      Object.entries(t)
      .filter(filter)
  ) as FullyDefined<T>
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

export interface IChangeset {
  changeset: {[k in string]?: string};
}

export interface IDiffResult {
  generator: string;
  version: string;
  elements: DiffResultElement[];
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

export interface IOCENode {
  tag: "OCENode";
  ocenodeId: number;
  changeset: number;
  lat: number;
  lon: number;
}

export interface IOCEWay {
  tag: "OCEWay";
  ocewayId: number;
  changeset: number;
  oceWayNodes: OCEWayNode[];
}

export interface IOCEWayNode {
  ref: number;
}

export interface IOsmBasic {
  value: CreateChangeset;
}

export interface IOsmChange {
  create: OsmChangeElement[];
  modify: OsmChangeElement[];
  delete: OsmChangeElement[];
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

export type DiffResult = IDiffResult;

export type DiffResultElement = "DRENode" | "DREWay" | "DRERelation";

export type Element = INode | IWay | IRelation;

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

export type OCEWayNode = IOCEWayNode;

export type OsmBasic = {"osm": IOsmBasic};

export type OsmChange = IOsmChange;

export type OsmChangeElement = IOCENode | IOCEWay;

export type OsmStandard = IOsmStandard;

export type Permission = "allow_read_prefs" | "allow_write_prefs" | "allow_write_diary" | "allow_write_api" | "allow_write_redactions" | "allow_read_gpx" | "allow_write_gpx" | "allow_write_notes";

export type Range = IRange;

export type RelationMember = IRmWay | IRmNode | IRmRelation;

export type Stati = IStati;

export type Status = "offline" | "readonly" | "online";
export function toQueryParamChangeset(a : Changeset) { return (((a) => a))(a) } 
export function toQueryParamDiffResult(a : DiffResult) { return (((a) => a))(a) } 
export function toQueryParamOsmBasic(a : OsmBasic) { return (((a) => a))(a) } 
export function toQueryParamOsmChange(a : OsmChange) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardApiCapabilities(a : OsmStandard & ApiCapabilities) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardBoundedElements(a : OsmStandard & BoundedElements) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardInaRecordapiInaRecordversionsApiVersion(a : OsmStandard & InaRecord_api_InaRecord_versions_ApiVersion) { return (((a) => a))(a) } 
export function toQueryParamOsmStandardInaRecordpermissionsPermission(a : OsmStandard & InaRecord_permissions_Permission) { return (((a) => a))(a) } 
export function toQueryParamnumber(a : number) { return (((a) => a))(a) } 
export function toQueryParamBbox(a : Bbox) { return ((a) => `${a.minlon},${a.minlat},${a.maxlon},${a.maxlat}`)(a) } 


const manualMapPickleParser = () => { throw "unimplemented - parsing kvp" }
const manualMapPickleBuilder = Picklers.buildKvp("tag", "k", "v")

const pickleChangesetObject = {
   changeset: {type: "element" as const, parser: manualMapPickleParser, builder: manualMapPickleBuilder},
}
const pickleChangesetParser = Picklers.parseObject(pickleChangesetObject)
const pickleChangesetBuilder = Picklers.buildObject(pickleChangesetObject)


