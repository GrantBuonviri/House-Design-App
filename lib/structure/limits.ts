import { codeNum, codeRef, codeText } from "@/lib/codes/data";

/**
 * Where the place's wind, snow or earthquakes are past what the IRC's
 * ready-made (prescriptive) rules cover. Each one means the structure must be
 * designed by an engineer, so the code check marks it "Engineer required".
 */
export type PlaceLimit = { kind: "wind" | "snow" | "seismic"; text: string };

export function placeLimits(): PlaceLimit[] {
  const out: PlaceLimit[] = [];
  const wind = codeNum("struct.windSpeedBasis");
  const windMax = codeNum("struct.windLimitMph");
  if (wind >= windMax)
    out.push({ kind: "wind", text: `The design wind speed here is ${wind} mph, and the IRC's own wall bracing and roof tie-down rules stop below ${windMax} mph (${codeRef("struct.windLimitMph")}). An engineer must design the structure for wind.` });
  const snow = codeNum("design.groundSnowLoad");
  const snowMax = codeNum("struct.snowLimitPsf");
  if (snow > snowMax)
    out.push({ kind: "snow", text: `The ground snow load here is ${snow} psf, past the ${snowMax} psf the IRC's framing tables cover (${codeRef("struct.snowLimitPsf")}). An engineer must design the roof and the walls that hold it up.` });
  const sdc = codeText("design.seismicCategory").toUpperCase();
  const engineerSdc = codeText("struct.seismicEngineerCategories").split(/,\s*/);
  if (engineerSdc.includes(sdc))
    out.push({ kind: "seismic", text: `Seismic design category ${sdc} is past the IRC's own earthquake rules (${codeRef("struct.seismicEngineerCategories")}). An engineer must design the structure.` });
  return out;
}
