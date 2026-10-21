/**
 * Process host that starts a detached conductor loop. The conductor package
 * owns only this contract; `@bakers-build/addon-herdr` implements it.
 */
export interface HerdrHost {
  spawn(label: string, cwd: string, cmd: string): Promise<void>;
}
