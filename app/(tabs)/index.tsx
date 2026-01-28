import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FAB } from "@rneui/themed";
import { StyleSheet, Text, View } from "react-native";
import * as MapLibreGL from "@maplibre/maplibre-react-native";
import type {
  PressEventWithFeatures,
  LngLat,
} from "@maplibre/maplibre-react-native";
import type { NativeSyntheticEvent } from "react-native";
import { useAndroidLocationPermission } from "@/components/AndroidLocationPermission";
import { PartialRecord, TargetNode, WayId } from "@/components/types";
import { MutationState, QueryState } from "@/components/queries";
import type GeoJSON from "geojson";
import * as Svg from "react-native-svg";
import { IconNode } from "@rneui/base";
import * as ExLoc from "expo-location";
import { CircleLayer } from "@maplibre/maplibre-react-native";
import { modalNotes, NearestPoint } from "@/components/diff-info";
import { Change } from "@/components/diff-info/shared";
import {
  useMainPageState,
  State,
  Action,
  Mode,
  unusedButOkay,
} from "@/components/useMainPageState";

const LayerIndexLookup = {
  roadcasingfill: 103,
  roadcasinglines: 104,
  points: 106,
  pointsOnWayNearClicks: 107,
  nearestPointLayer: 108,
};

const roadStrokesLayerStyle = (
  wayIds: string[] | null
): MapLibreGL.LineLayerStyle => ({
  lineColor: wayIds
    ? ["case", ["in", ["id"], ["literal", wayIds]], "purple", "red"]
    : "red",
  lineOpacity: 1,
});

const roadcasingsLayerStyle = (
  wayIds: string[] | null
): MapLibreGL.FillLayerStyle => ({
  fillColor: wayIds
    ? ["case", ["in", ["id"], ["literal", wayIds]], "purple", "red"]
    : "red",
  fillOpacity: [
    "case",
    ["in", ["geometry-type"], ["literal", "Polygon"]],
    0.98,
    0,
  ],
});

const pointsOnWayNearClickLayerStyle = (
  nodeIds: string[]
): MapLibreGL.CircleLayerStyle => ({
  circleColor: ["case", ["in", ["id"], ["literal", nodeIds]], "blue", "gray"],
  circleOpacity: 1,
  circleStrokeWidth: 2,
  circleStrokeColor: "white",
  circleRadius: 5,
  circlePitchAlignment: "map",
});

const circleLayerStyle = (
  input: number | undefined
): MapLibreGL.CircleLayerStyle => ({
  circleColor: input
    ? ["case", ["==", ["id"], input.toString()], "yellow", "purple"]
    : "green",
  circleOpacity: 0.84,
  circleStrokeWidth: 2,
  circleStrokeColor: "white",
  circleRadius: 5,
  circlePitchAlignment: "map",
});

const styles = StyleSheet.create({
  fab1: {
    position: "absolute",
    margin: 16,
    left: 0,
    bottom: 48,
  },
  fab: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 48,
  },
  page: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F5FCFF",
  },
  map: {
    flex: 1,
    alignSelf: "stretch",
  },
});

function buildStatusString(
  debouncers: boolean[],
  queries: PartialRecord<
    string,
    MutationState<unknown, unknown> | QueryState<unknown, unknown>
  >
) {
  const buildStatusStr = (
    m: MutationState<unknown, unknown> | QueryState<unknown, unknown>
  ): [string, string] => {
    if ("fetchStatus" in m) {
      switch (m.status) {
        case "success":
          switch (m.fetchStatus) {
            case "idle":
              return ["S", "black"];
            case "paused":
              return ["5", "black"];
            case "fetching":
              return ["s", "red"];
            default:
              return ["0", "black"];
          }
        case "error":
          switch (m.fetchStatus) {
            case "idle":
              return ["E", "orange"];
            case "paused":
              return ["3", "orange"];
            case "fetching":
              return ["e", "red"];
            default:
              return ["1", "orange"];
          }
        case "pending":
          switch (m.fetchStatus) {
            case "idle":
              return ["P", "navy"];
            case "paused":
              return ["B", "navy"];
            case "fetching":
              return ["p", "red"];
            default:
              return ["1", "black"];
          }
      }
    } else {
      switch (m.status) {
        case "idle":
          return ["_*", "black"];
        case "error":
          return ["e*", "orange"];
        case "pending":
          return ["p*", "red"];
        case "success":
          return ["S*", "navy"];
      }
    }
  };

  return Object.entries(queries)
    .sort(([k1], [k2]) => k1.localeCompare(k2))
    .map(([k, m]) => {
      const [status, color] = buildStatusStr(m!);
      const identifier =
        k[0] +
        k
          .split("")
          .filter((k) => /[A-Z]/.test(k))
          .join("");
      return (
        <Text key={k} style={{ color }}>
          {identifier + status}
        </Text>
      );
    })
    .concat(
      debouncers.map((d, i) => (
        <Text key={"d" + i} style={{ color: d ? "red" : "black" }}>
          {d ? "P" : "_"}
        </Text>
      ))
    );
}

function MapAddStopSign({
  state,
  setCommentary,
  highlightWays,
  setNotes,
  setChanges,
  setTappedLocation,
  dispatch,
}: {
  setTappedLocation: (a: GeoJSON.Point) => void;
  state: State;
  highlightWays: WayId[];
  dispatch: (a: Action) => void;
  setNotes: (notes: string[]) => void;
  setCommentary: (c: [string, string | undefined]) => void;
  setChanges: (changes: Change[]) => void;
}) {
  const refTappedLoc = useRef<MapLibreGL.PointAnnotationRef>(null);
  const refNearestPointAnnoPoint = useRef<MapLibreGL.PointAnnotationRef>(null);
  const refNearestPointShape = useRef<MapLibreGL.GeoJSONSourceRef>(null);

  const editableSign =
    state.modes.addStopSign.change.tappedLocation?.type === "Feature"
      ? state.modes.addStopSign.change.tappedLocation.geometry
      : state.modes.addStopSign.change.tappedLocation?.point;
  const constructedSign = useMemo(() => {
    const activeWays =
      state.queries.queryWays_.data?.centrelines?.features.filter(
        (f) => f.id && highlightWays.includes(f.id.toString())
      ) || [];
    return modalNotes(
      state.intersections_m,
      state.modes.addStopSign.change,
      activeWays
    );
  }, [
    state.intersections_m,
    state.modes.addStopSign.change,
    state.queries.queryWays_.data?.centrelines?.features,
    highlightWays,
  ]);
  useEffect(() => {
    const notes = [
      ...constructedSign.notes,
      "hu",
      JSON.stringify(constructedSign.osmChange),
    ];
    setNotes(notes);
    setChanges([]);
    setCommentary([
      `hke${constructedSign.commentary[0]}\n${JSON.stringify(
        constructedSign.osmChange
      )}`,
      `hka${constructedSign.commentary[1]}\n${JSON.stringify(
        constructedSign.osmChange
      )}`,
    ]);
  }, [constructedSign, setNotes, setChanges, setCommentary]);
  const signFaceAngle = constructedSign.signFaceAngle;
  const radians =
    signFaceAngle === undefined ? undefined : (signFaceAngle * Math.PI) / 180;
  const setNearestPointLocation = (event: FeaturePayload) =>
    dispatch({
      action: "modal",
      mode: "addStopSign",
      modalAction: {
        action: "updated highway location",
        point: event.geometry,
      },
    });
  const nearestPoint =
    state.modes.addStopSign.change.highwayLocation?.type === "new"
      ? state.modes.addStopSign.change.highwayLocation
      : undefined;

  const nearestPointShape:
    | GeoJSON.FeatureCollection<GeoJSON.Point, object>
    | undefined = nearestPoint
    ? { type: "FeatureCollection", features: [nearestPoint.point] }
    : undefined;
  const nearestPointFeature = nearestPoint?.point;
  const nearestPointId = nearestPointFeature?.id
    ? [nearestPointFeature.id.toString()]
    : [];

  const dragEndSignLocation = useCallback(
    (e: FeaturePayload) => setTappedLocation(e.geometry),
    [setTappedLocation]
  );

  return (
    <>
      {nearestPoint && (
        <>
          <MapLibreGL.PointAnnotation
            style={{ zIndex: 3, elevation: 3 }}
            key={nearestPoint.way}
            ref={refNearestPointAnnoPoint}
            onSelected={(e) => console.log("selected", e)}
            onDragEnd={setNearestPointLocation}
            id={`nearestpoint-${nearestPoint.way}`}
            coordinate={nearestPoint.point.geometry.coordinates}
            draggable={true}
          >
            <View style={{ zIndex: 3, elevation: 3 }}>
              <Svg.Svg height="10" width="10" viewBox="0 0 100 100">
                <Svg.Circle
                  cx="50"
                  cy="50"
                  r="43"
                  stroke="orange"
                  strokeWidth="14"
                  fill="yellow"
                />
              </Svg.Svg>
            </View>
          </MapLibreGL.PointAnnotation>
          <MapLibreGL.GeoJSONSource
            id="nearestPointShape"
            data={nearestPointShape!}
            ref={refNearestPointShape}
          >
            <CircleLayer
              layerIndex={LayerIndexLookup["nearestPointLayer"]}
              id="nearestPointLayer"
              style={pointsOnWayNearClickLayerStyle(nearestPointId)}
            />
          </MapLibreGL.GeoJSONSource>
        </>
      )}
      {editableSign && (
        <MapLibreGL.PointAnnotation
          key={radians}
          ref={refTappedLoc}
          onDragEnd={dragEndSignLocation}
          id="centrepoint"
          coordinate={editableSign.coordinates}
          draggable={true}
        >
          <View>
            <Svg.Svg height="25" width="25" viewBox="0 0 100 100">
              <Svg.Defs>
                <Svg.Marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <Svg.Path stroke="orange" d="M 0 0 L 10 5 L 0 10 z" />
                </Svg.Marker>
              </Svg.Defs>
              <Svg.Circle
                cx="50"
                cy="50"
                r="43"
                stroke="blue"
                strokeWidth="7"
                fill="none"
              />
              {radians !== undefined ? (
                <>
                  <Svg.Line
                    stroke={radians !== 0 ? "red" : "black"}
                    strokeWidth="10"
                    x1={50 + 43 * Math.cos(radians + Math.PI)}
                    y1={50 + 43 * Math.sin(radians + Math.PI)}
                    x2={50 + 43 * Math.cos(radians)}
                    y2={50 + 43 * Math.sin(radians)}
                  ></Svg.Line>
                  <Svg.Line
                    markerEnd="url(#arrow)"
                    stroke={radians !== 0 ? "orange" : "black"}
                    strokeWidth="10"
                    x1={50}
                    y1={50}
                    x2={50 + 43 * Math.cos(radians - Math.PI / 2)}
                    y2={50 + 43 * Math.sin(radians - Math.PI / 2)}
                  ></Svg.Line>
                </>
              ) : (
                false
              )}
            </Svg.Svg>
          </View>
        </MapLibreGL.PointAnnotation>
      )}
    </>
  );
}

// noinspection JSUnusedGlobalSymbols default export is automatically included by expo-router
export default function MainPage() {
  /* standard/project effects */
  const {
    state,
    dispatch,
    interestingPoints,
    symbols,
    roadcasings,
    highlightWays,
    selectedInterestingPoints,
    setTappedLocation,
    changes,
    setChanges,
    commentary,
    setCommentary,
    notes,
    setNotes,
    debSaveUpdateIsPending,
  } = useMainPageState();

  useAndroidLocationPermission(undefined);
  const refCamera = useRef<MapLibreGL.CameraRef>(null);
  const refHighwaystopSource = useRef<MapLibreGL.GeoJSONSourceRef>(null);
  const refPointsOnWayNearClickSource =
    useRef<MapLibreGL.GeoJSONSourceRef>(null);
  const refRoadcasingsSource = useRef<MapLibreGL.GeoJSONSourceRef>(null);
  const refMapView = useRef<MapLibreGL.MapViewRef | null>(null);

  const fab = true;
  const [subFab, setSubFab] = useState(false);

  /* callbacks */
  const onPressMap = (event: NativeSyntheticEvent<MapLibreGL.PressEvent>) => {
    const { lngLat } = event.nativeEvent;
    console.log("from map", lngLat);
    const point: GeoJSON.Point = { type: "Point", coordinates: lngLat };
    setTappedLocation(point, true);
  };
  const onPressWay = (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
    const { features, lngLat } = event.nativeEvent;
    console.log("from way", features, lngLat);
    switch (state.mode) {
      case "addStopSign":
        return dispatch({
          action: "modal",
          mode: "addStopSign",
          modalAction: {
            action: "select ways",
            ways: features.map((i) => i.id!.toString()),
            select: "toggle",
            point: lngLat,
          },
        });
      case "browse":
        return;
      default:
        unusedButOkay(state.mode);
        return;
    }
  };
  const statusString = buildStatusString(
    [debSaveUpdateIsPending],
    state.queries
  );

  const onMapBoundChange = (
    event: NativeSyntheticEvent<MapLibreGL.ViewStateChangeEvent>
  ) => {
    const state = event.nativeEvent;
    console.log("+++++++++++++++observed map bounds change", state);
    // v11 bounds format: [west, south, east, north] = [minlon, minlat, maxlon, maxlat]
    const bounds = state.bounds;
    if (bounds) {
      const [minlon, minlat, maxlon, maxlat] = bounds;
      dispatch({
        action: "set visible bounds",
        visibleBounds: { minlon, minlat, maxlon, maxlat },
      });
    }
    // v11 uses center and zoom directly
    if (state.center && state.zoom !== undefined) {
      console.log("setting zoom from event", state.zoom, state.center);
      dispatch({
        action: "set zoom",
        centreCoordinates: state.center,
        zoom: state.zoom,
      });
    }
  };

  const [defaultOptionText, defaultOptionIcon, subfabs] = fabFromMode(
    state.mode
  );
  const fabButtonPress = () => {
    switch (state.mode) {
      case "browse":
        return setSubFab(!subFab);
      case "addStopSign":
        return console.log("need to support adding signs");
    }
  };
  const fabButtonLongPress = () => {
    setSubFab(true);
  };

  const onPressSelectInterestingPoint = (
    event: NativeSyntheticEvent<PressEventWithFeatures>
  ) => {
    switch (state.mode) {
      case "addStopSign":
        const features: GeoJSON.Feature<GeoJSON.Geometry, unknown>[] =
          event.nativeEvent.features;
        console.log(
          "an interesting point has been selected!",
          event.nativeEvent
        );
        if (features.length === 1) {
          const feature = features[0];
          if (feature.geometry.type === "Point") {
            dispatch({
              action: "modal",
              mode: "addStopSign",
              modalAction: {
                action: "select interesting point",
                point: feature as TargetNode,
              },
            });
          }
        } else if (features.length > 1) {
          dispatch({ action: "set zoom", zoom: state.zoom + 2 });
        }
        features.forEach((f) => console.log("properties", f.properties));
        return;
      case "browse":
        return;
      default:
        unusedButOkay(state.mode);
        return;
    }
  };

  const modalMap =
    state.mode === "addStopSign" ? (
      <MapAddStopSign
        highlightWays={highlightWays}
        state={state}
        setNotes={setNotes}
        setCommentary={setCommentary}
        setChanges={setChanges}
        dispatch={dispatch}
        setTappedLocation={setTappedLocation}
      />
    ) : state.mode === "browse" || state.mode === "testO" ? (
      false
    ) : (
      (unusedButOkay(state.mode), undefined)
    );

  const locFab =
    state.mode === "addStopSign" &&
    !state.modes.addStopSign.change.tappedLocation &&
    (async () => {
      let { status } = await ExLoc.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.log("Permission to access location was denied");
        return;
      }

      let location = await ExLoc.getCurrentPositionAsync({});
      dispatch({
        action: "modal",
        mode: "addStopSign",
        modalAction: {
          action: "add stop sign",
          newId: `new-${7}` as const,
          tappedLocation: {
            type: "Point",
            coordinates: [location.coords.longitude, location.coords.latitude],
          },
        },
      });
    });

  return (
    <View style={styles.page}>
      <View
        style={{
          flexWrap: "wrap",
          alignContent: "center",
          flexDirection: "row",
          gap: 4,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        {statusString}
      </View>
      <MapLibreGL.MapView
        onRegionDidChange={onMapBoundChange}
        ref={refMapView}
        style={styles.map}
        logo={false}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        onPress={onPressMap}
      >
        {modalMap}
        {interestingPoints && (
          <MapLibreGL.GeoJSONSource
            id="interestingPoints"
            data={interestingPoints}
            ref={refPointsOnWayNearClickSource}
            onPress={onPressSelectInterestingPoint}
          >
            <CircleLayer
              layerIndex={LayerIndexLookup.pointsOnWayNearClicks}
              id="pointsOnWayNearClicks"
              style={pointsOnWayNearClickLayerStyle(selectedInterestingPoints)}
            />
          </MapLibreGL.GeoJSONSource>
        )}
        {symbols && (
          <MapLibreGL.GeoJSONSource
            id="highwaystop"
            data={symbols}
            ref={refHighwaystopSource}
          >
            <CircleLayer
              id="points"
              layerIndex={LayerIndexLookup.points}
              style={circleLayerStyle(undefined)}
            />
          </MapLibreGL.GeoJSONSource>
        )}
        {roadcasings && (
          <MapLibreGL.GeoJSONSource
            id="roadcasing"
            data={roadcasings}
            ref={refRoadcasingsSource}
            onPress={onPressWay}
          >
            <MapLibreGL.FillLayer
              id="roadcasingfill"
              layerIndex={LayerIndexLookup.roadcasingfill}
              style={roadcasingsLayerStyle(highlightWays)}
            />
            <MapLibreGL.LineLayer
              id="roadstrokeslines"
              layerIndex={LayerIndexLookup.roadcasinglines}
              filter={["==", ["geometry-type"], "LineString"]}
              style={roadStrokesLayerStyle(highlightWays)}
            />
          </MapLibreGL.GeoJSONSource>
        )}
        <MapLibreGL.Camera
          ref={refCamera}
          center={state.centreCoordinates as LngLat | undefined}
          zoom={state.zoom}
          trackUserLocation="default"
        />
      </MapLibreGL.MapView>
      {(notes.length > 0 || changes.length > 0) && (
        <View
          style={{
            left: 0,
            top: 0,
            margin: 16,
            padding: 16,
            backgroundColor: "#f0edeecc",
            position: "absolute",
          }}
        >
          {notes.map((note, i) => (
            <Text key={i}>{note}</Text>
          ))}
          {changes.map((note, i) => (
            <Text style={{ fontFamily: "monospace" }} key={i}>
              {JSON.stringify(note)}
            </Text>
          ))}
        </View>
      )}
      {locFab && (
        <FAB
          style={{
            left: 0,
            alignItems: "flex-start",
            position: "absolute",
            margin: 16,
            marginTop: 32,
            rowGap: 32,
            bottom: 0,
          }}
          visible={true}
          onPress={locFab}
          title={"+"}
          icon={undefined}
          color="green"
        />
      )}
      <View
        style={{
          right: 0,
          alignItems: "flex-end",
          position: "absolute",
          margin: 16,
          marginTop: 32,
          rowGap: 32,
          bottom: 0,
        }}
      >
        {subfabs.map(({ icon, mode, text }) => (
          <FAB
            key={mode}
            visible={subFab}
            onPress={() => {
              setSubFab(false);
              dispatch({ action: "set mode", mode });
            }}
            title={text}
            icon={icon}
            color="orange"
          />
        ))}
        <FAB
          visible={fab}
          onPress={fabButtonPress}
          onLongPress={fabButtonLongPress}
          title={defaultOptionText}
          icon={defaultOptionIcon}
          color="orange"
        />
      </View>
    </View>
  );
}

const fabFromMode = (
  mode: Mode
): [
  string | undefined,
  IconNode,
  {
    icon: IconNode;
    text: string | undefined;
    mode: Mode;
  }[]
] => {
  switch (mode) {
    case "browse":
      return [
        undefined,
        { name: "menu", color: "white", type: "material-community" },
        [
          {
            icon: { name: "octagon", color: "red", type: "material-community" },
            text: "Stop",
            mode: "addStopSign",
          },
        ],
      ];

    case "addStopSign":
      return [
        "Add Stop Sign",
        { name: "octagon", color: "white", type: "material-community" },
        [
          {
            icon: { name: "cancel", color: "white", type: "material" },
            text: "Cancel",
            mode: "browse",
          },
        ],
      ];
  }
};

const sha256: (ascii: string) => string | undefined = function sha256(
  ascii: string
): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  let mathPow = Math.pow;
  let maxWord = mathPow(2, 32);
  const lengthProperty = "length";
  let i, j; // Used as a counter across the whole file
  let result = "";

  let words: number[] = [];
  let asciiBitLength = ascii[lengthProperty] * 8;

  /* caching results is optional - remove/add slash from front of this line to toggle
  // Initial hash value: first 32 bits of the fractional parts of the square roots of the first 8 primes
  // (we actually calculate the first 64, but extra values are just ignored)
  var hash: number[] = sha256h.h = sha256h.h || [];
  // Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes
  var k: number[] = sha256h.k = sha256h.k || [];
  var primeCounter = k[lengthProperty];
  /*/
  let hash: number[] = [],
    k: number[] = [];
  let primeCounter = 0;
  //*/

  let isComposite: PartialRecord<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += "\x80"; // Append Ƈ' bit (plus zero padding)
  while ((ascii[lengthProperty] % 64) - 56) ascii += "\x00"; // More zero padding
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) throw ["character out of range", i, j]; // ASCII check: only accept characters in range 0-255
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  // process each chunk
  for (j = 0; j < words[lengthProperty]; ) {
    let w = words.slice(j, (j += 16)); // The message is expanded into 64 words as part of the iteration
    let oldHash = hash;
    // This is now the undefinedworking hash", often labelled as variables a...g
    // (we have to truncate as well, otherwise extra entries at the end accumulate
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      // Expand the message into 64 words
      // Used below if
      let w15 = w[i - 15],
        w2 = w[i - 2];

      // Iterate
      let a = hash[0],
        e = hash[4];
      let temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + // S1
        ((e & hash[5]) ^ (~e & hash[6])) + // ch
        k[i] +
        // Expand the message schedule if needed
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + // s0
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | // s1
              0);
      // This is only used once, so *could* be moved below, but it only saves 4 bytes and makes things unreadble
      let temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + // S0
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2])); // maj

      hash = [(temp1 + temp2) | 0].concat(hash); // We don't bother trimming off the extra ones, they're harmless as
      // long as we're truncating when we do the slice()
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      let b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : "") + b.toString(16);
    }
  }
  console.log("hash result");
  return result;
};

function bytesToBase64(str: string) {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) =>
    String.fromCodePoint(byte)
  ).join("");
  return btoa(binString);
}

type FeaturePayload = GeoJSON.Feature<
  GeoJSON.Point,
  {
    screenPointX: number;
    screenPointY: number;
  }
>;
