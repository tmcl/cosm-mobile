import * as OsmDiff from './osm-diff'
import {DOMImplementation, XMLSerializer} from "@xmldom/xmldom";

describe('OSMChange XML Builder', () => {
  it('should serialize nodes, ways, and relations correctly', () => {
    const testOsmChange: OsmDiff.OsmChange = {
      version: "0.6",
      generator: "test-suite",
      create: [
        {
          tag: "node",
          version: 0,
          id: 1,
          changeset: 123,
          lat: -37.81,
          lon: 144.96,
          tags: { amenity: "cafe" }
        },
        {
          tag: "way",
          version: 0,
          id: 2,
          changeset: 123,
          nodes: [{ ref: 1 }, { ref: 3 }],
          tags: { highway: "residential" }
        },
        {
          tag: "relation",
          version: 0,
          id: 3,
          changeset: 123,
          members: [
            { type: "way", ref: 2, role: "outer" },
            { type: "node", ref: 1, role: "" }
          ],
          tags: { type: "multipolygon", name: "park" }
        }
      ]
    };

    const domImpl = new DOMImplementation();
    const doc = domImpl.createDocument(null, 'osmChange');
    OsmDiff.buildOsmChangeXML(doc, testOsmChange);
    const xml = new XMLSerializer().serializeToString(doc);

    const expected= `<osmChange version="0.6" generator="test-suite"><create><node id="1" changeset="123" version="0" lat="-37.81" lon="144.96"><tag k="amenity" v="cafe"/></node><way id="2" changeset="123" version="0"><nd ref="1"/><nd ref="3"/><tag k="highway" v="residential"/></way><relation id="3" changeset="123" version="0"><member type="way" ref="2" role="outer"/><member type="node" ref="1" role=""/><tag k="type" v="multipolygon"/><tag k="name" v="park"/></relation></create></osmChange>`
    expect(xml).toBe(expected);
  });
});