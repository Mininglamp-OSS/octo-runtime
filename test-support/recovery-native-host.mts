import {
  createKernelService,
  createExtraService,
  type KernelServiceOptions,
  type ExtraServiceOptions
} from "@mininglamp-oss/octo-runtime/host";

/** 测试宿主直接使用公共 factory；不调用 CLI、不重建宿主、不装入用户配置。 */
export async function recoveryNativeHost(
  kernelOptions: KernelServiceOptions,
  extraOptions: ExtraServiceOptions
) {
  const kernel = createKernelService(kernelOptions);
  const extra = createExtraService(extraOptions);
  try {
    await kernel.initialize();
    await extra.initialize();
    return {
      kernel,
      extra,
      pid: process.pid,
      initializeCount: 1,
      async close() {
        const extraCleanup = await extra.close();
        const kernelCleanup = await kernel.close();
        return { extraCleanup, kernelCleanup };
      }
    };
  } catch (error) {
    await extra.close();
    await kernel.close();
    throw error;
  }
}
