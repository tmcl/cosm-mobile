import { OsmChange } from "./ts-xml-object-parser/osm-diff";
import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";
import * as OsmDiff from "@/scripts/ts-xml-object-parser/osm-diff";

export function putApi06ChangesetByChangesetidUploadText(
  body: OsmChange,
  changesetid: number,
): Promise<string> {
  let options: RequestInit = {
    credentials: "same-origin" as RequestCredentials,
    method: "PUT",
    headers: { Accept: "text/xml" },
  };

  const domImpl = new DOMImplementation();
  const doc = domImpl.createDocument(null, "osmChange");

  OsmDiff.buildOsmChangeXML(doc, body);
  options.body = new XMLSerializer().serializeToString(doc);

  let params = {};
  console.log(
    `https://master.apis.dev.openstreetmap.org/api/0.6/changeset/${changesetid}/upload` +
      "?" +
      new URLSearchParams(params).toString(),
    JSON.stringify(options),
  );
  return Promise.reject("unimplemented");
}
