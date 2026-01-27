export interface OsmChange {
  version: "0.6";
  generator: string; // e.g., "your app name"
  create?: OsmChangeElements;
  modify?: OsmChangeElements;
  delete?: OsmChangeElements;
}
export type OsmChangeElements = OsmChangeElement[];

export type OsmChangeElement = IOCENode | IOCEWay | IOCERelation;

export interface IOCENode {
  tag: "node";
  id: number;
  changeset?: number;
  version: number;
  lat: number;
  lon: number;
  visible?: boolean;
  tags?: Record<string, string>;
}

export interface IOCEWay {
  tag: "way";
  id: number;
  changeset?: number;
  version: number;
  nodes: IOCEWayNode[];
  visible?: boolean;
  tags?: Record<string, string>;
}

export interface IOCEWayNode {
  ref: number;
}

export interface IOCERelation {
  tag: "relation";
  id: number;
  changeset?: number;
  version: number;
  visible?: boolean;
  members: IOCERelationMember[];
  tags?: Record<string, string>;
}

export interface IOCERelationMember {
  type: "node" | "way" | "relation";
  ref: number;
  role?: string;
}

export function buildOsmChangeXML(
  doc: XMLDocument,
  osmChange: OsmChange
): void {
  const root = doc.documentElement;
  root.setAttribute("version", osmChange.version);
  root.setAttribute("generator", osmChange.generator);

  for (const action of ["create", "modify", "delete"] as const) {
    const elements = osmChange[action];
    if (!elements || elements.length === 0) continue;

    const actionElem = doc.createElement(action);
    for (const elem of elements) {
      if (elem.tag === "node") {
        const nodeElem = doc.createElement("node");
        nodeElem.setAttribute("id", elem.id.toString());
        if (elem.changeset !== undefined)
          nodeElem.setAttribute("changeset", elem.changeset.toString());
        if (elem.version !== undefined)
          nodeElem.setAttribute("version", elem.version.toString());
        nodeElem.setAttribute("lat", elem.lat.toString());
        nodeElem.setAttribute("lon", elem.lon.toString());
        if (elem.visible !== undefined)
          nodeElem.setAttribute("visible", elem.visible ? "true" : "false");

        // Omit tags for delete
        if (action !== "delete" && elem.tags) {
          for (const [k, v] of Object.entries(elem.tags)) {
            const tagElem = doc.createElement("tag");
            tagElem.setAttribute("k", k);
            tagElem.setAttribute("v", v);
            nodeElem.appendChild(tagElem);
          }
        }

        actionElem.appendChild(nodeElem);
      } else if (elem.tag === "way") {
        const wayElem = doc.createElement("way");
        wayElem.setAttribute("id", elem.id.toString());
        if (elem.changeset !== undefined)
          wayElem.setAttribute("changeset", elem.changeset.toString());
        if (elem.version !== undefined)
          wayElem.setAttribute("version", elem.version.toString());
        if (elem.visible !== undefined)
          wayElem.setAttribute("visible", elem.visible ? "true" : "false");

        for (const node of elem.nodes) {
          const ndElem = doc.createElement("nd");
          ndElem.setAttribute("ref", node.ref.toString());
          wayElem.appendChild(ndElem);
        }

        if (action !== "delete" && elem.tags) {
          for (const [k, v] of Object.entries(elem.tags)) {
            const tagElem = doc.createElement("tag");
            tagElem.setAttribute("k", k);
            tagElem.setAttribute("v", v);
            wayElem.appendChild(tagElem);
          }
        }

        actionElem.appendChild(wayElem);
      } else if (elem.tag === "relation") {
        const relElem = doc.createElement("relation");
        relElem.setAttribute("id", elem.id.toString());
        if (elem.changeset !== undefined)
          relElem.setAttribute("changeset", elem.changeset.toString());
        if (elem.version !== undefined)
          relElem.setAttribute("version", elem.version.toString());
        if (elem.visible !== undefined)
          relElem.setAttribute("visible", elem.visible ? "true" : "false");

        // Members
        for (const member of elem.members) {
          const memElem = doc.createElement("member");
          memElem.setAttribute("type", member.type);
          memElem.setAttribute("ref", member.ref.toString());
          if (member.role !== undefined)
            memElem.setAttribute("role", member.role);
          relElem.appendChild(memElem);
        }

        // Tags
        if (action !== "delete" && elem.tags) {
          for (const [k, v] of Object.entries(elem.tags)) {
            const tagElem = doc.createElement("tag");
            tagElem.setAttribute("k", k);
            tagElem.setAttribute("v", v);
            relElem.appendChild(tagElem);
          }
        }

        actionElem.appendChild(relElem);
      }
    }
    root.appendChild(actionElem);
  }
}
