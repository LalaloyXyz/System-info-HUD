import { BaseModule } from './baseModule.js';

export class GPUModule extends BaseModule {
    constructor() {
        super(2000); // 2 second cache TTL
    }

    async getGPUInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        return new Promise((resolve) => {
            this._getGpuInfoAsync((result) => {
                this._updateCache(result);
                resolve(result);
            });
        });
    }

    _getGpuInfoAsync(callback) {
        try {
            let resultList = [];
            let pendingChecks = 3;

            const checkComplete = () => {
                pendingChecks--;
                if (pendingChecks === 0) {
                    const finalResult = resultList.length > 0 
                        ? resultList.join('\n\n') 
                        : 'GPU info not available (sudo or drivers may be required)';
                    callback(finalResult);
                }
            };

            // NVIDIA Check
            this._checkNVIDIA(resultList, checkComplete);
            
            // AMD Check
            this._checkAMD(resultList, checkComplete);
            
            // Intel/Fallback Check
            this._checkIntel(resultList, checkComplete);
        } catch (e) {
            console.error(`Error fetching GPU info: ${e}`);
            callback('Error fetching GPU info');
        }
    }

    async _checkNVIDIA(resultList, checkComplete) {
        try {
            const nvidiaPath = await this._executeCommand(['which', 'nvidia-smi']);
            if (nvidiaPath.trim() !== "") {
                const nvidiaData = await this._executeCommand([
                    'nvidia-smi', 
                    '--query-gpu=name,memory.total,memory.used,temperature.gpu', 
                    '--format=csv,noheader,nounits'
                ]);
                
                if (nvidiaData) {
                    const gpuLines = nvidiaData.trim().split('\n');
                    gpuLines.forEach(line => {
                        const [name, total, used, temp] = line.split(',').map(s => s.trim());
                        const load = Math.round((parseInt(used) / parseInt(total)) * 100);
                        const loadEmoji = this._getStatusEmoji(load, [90, 70, 50, 30]);
                        
                        let tempEmoji = "⬜️";
                        if (temp !== "N/A") {
                            const tempNum = parseFloat(temp);
                            tempEmoji = this._getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                        }

                        resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${used}MB / ${total}MB ] [${load}%] ${tempEmoji} Temp ${temp} °C`);
                    });
                }
            }
        } catch (e) {
            console.error(`Error processing NVIDIA GPU info: ${e}`);
        } finally {
            checkComplete();
        }
    }

    async _checkAMD(resultList, checkComplete) {
        try {
            const amdPath = await this._executeCommand(['which', 'rocm-smi']);
            if (amdPath.trim() !== "") {
                const amdData = await this._executeCommand([
                    'rocm-smi', 
                    '--showproductname', 
                    '--showmemuse', 
                    '--json'
                ]);
                
                if (amdData) {
                    const amdInfo = JSON.parse(amdData.trim());
                    for (const key in amdInfo) {
                        const gpu = amdInfo[key];
                        if (gpu["Card series"]) {
                            const name = gpu["Card series"];
                            const used = parseInt(gpu["VRAM Used Memory (B)"]) / (1024 * 1024);
                            const total = parseInt(gpu["VRAM Total Memory (B)"]) / (1024 * 1024);
                            const temp = gpu["Temperature (C)"];

                            const load = Math.round((used / total) * 100);
                            const loadEmoji = this._getStatusEmoji(load, [90, 70, 50, 30]);

                            let tempEmoji = "⬜️";
                            if (temp !== "N/A") {
                                const tempNum = parseFloat(temp);
                                tempEmoji = this._getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                            }

                            resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${Math.round(used)}MB / ${Math.round(total)}MB ] [${load}%] ${tempEmoji} Temp ${temp} °C`);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`Error processing AMD GPU info: ${e}`);
        } finally {
            checkComplete();
        }
    }

    async _checkIntel(resultList, checkComplete) {
        try {
            const lspciOutput = await this._executeCommand(['lspci']);
            const intelMatch = lspciOutput.match(/VGA.*Intel.*\[([^\]]+)\]/i);
            const amdMatch = lspciOutput.match(/VGA.*AMD.*\[([^\]]+)\]/i);
            const nvidiaMatch = lspciOutput.match(/VGA.*NVIDIA.*\[([^\]]+)\]/i);

            if (intelMatch) {
                resultList.push(`GPU${resultList.length} - [ ${intelMatch[1]} ]`);
            } else if (amdMatch) {
                resultList.push(`GPU${resultList.length} - [ ${amdMatch[1]} ]`);
            } else if (nvidiaMatch) {
                resultList.push(`GPU${resultList.length} - [ ${nvidiaMatch[1]} ]`);
            }

            if (resultList.length === 0) {
                const vgaMatch = lspciOutput.match(/VGA.*\[([^\]]+)\]/i);
                if (vgaMatch) {
                    resultList.push(`GPU${resultList.length} - [ ${vgaMatch[1]} ]`);
                }
            }
        } catch (e) {
            console.error(`Error checking Intel/Fallback: ${e}`);
        } finally {
            checkComplete();
        }
    }

    getInfo() {
        return this.getGPUInfo();
    }
} 