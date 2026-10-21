/** The public demo (github.com/kollaudo/demo): a made-up shop with data to look at. */
export const DEMO_HOST = "demo.kollaudo.dev";

/** A read token of the demo project. It is public (it is in the README) and can't change anything. */
export const DEMO_READ_TOKEN = "kol_VQ81iRttbMjk4pck5KXQ9gEbzLTMlgJAxWud2NIJ3us";

export function isDemoHost(hostname: string) {
  return hostname === DEMO_HOST;
}
