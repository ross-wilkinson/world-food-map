declare module "versor" {
  type Vec3 = [number, number, number];
  type Quat = [number, number, number, number];
  interface Versor {
    (angles: [number, number, number]): Quat;
    cartesian(spherical: [number, number]): Vec3;
    rotation(q: Quat): [number, number, number];
    delta(v0: Vec3, v1: Vec3, alpha?: number): Quat;
    multiply(a: Quat, b: Quat): Quat;
  }
  const versor: Versor;
  export default versor;
}
