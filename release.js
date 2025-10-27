#!/usr/bin/env bun

/**
 * 版本发布脚本 (Bun 版本)
 * 用法: bun release.js [patch|minor|major] [commit_message]
 * 示例: bun release.js patch "修复连接重试逻辑"
 * 示例: bun release.js minor "添加新的API接口"
 * 示例: bun release.js major "重构核心架构"
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// 颜色定义
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

// 打印带颜色的消息
function printInfo(message) {
    console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
}

function printSuccess(message) {
    console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`);
}

function printWarning(message) {
    console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`);
}

function printError(message) {
    console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
}

// 执行命令并返回结果
function execCommand(command, options = {}) {
    try {
        const result = execSync(command, { 
            encoding: 'utf8', 
            stdio: options.silent ? 'pipe' : 'inherit',
            ...options 
        });
        return { success: true, output: result };
    } catch (error) {
        return { success: false, error: error.message, output: error.stdout };
    }
}

// 检查命令是否存在
function commandExists(command) {
    try {
        execSync(`which ${command}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// 计算新版本号
function calculateNewVersion(currentVersion, versionType) {
    const parts = currentVersion.split('.').map(Number);
    let [major, minor, patch] = parts;

    switch (versionType) {
        case 'patch':
            patch += 1;
            break;
        case 'minor':
            minor += 1;
            patch = 0;
            break;
        case 'major':
            major += 1;
            minor = 0;
            patch = 0;
            break;
        default:
            throw new Error(`无效的版本类型: ${versionType}`);
    }

    return `${major}.${minor}.${patch}`;
}

// 更新 package.json 版本号
function updatePackageVersion(newVersion) {
    const packagePath = path.join(process.cwd(), 'package.json');
    
    if (!fs.existsSync(packagePath)) {
        throw new Error('package.json 文件不存在');
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const oldVersion = packageJson.version;
    
    packageJson.version = newVersion;
    
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
    
    return oldVersion;
}

// 获取用户确认
function getUserConfirmation(message) {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(`${message} (y/N): `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

// 主函数
async function main() {
    try {
        // 检查参数
        const args = process.argv.slice(2);
        if (args.length < 1) {
            printError('用法: bun release.js [patch|minor|major] [commit_message]');
            printInfo('patch  - 修复版本 (1.0.0 -> 1.0.1)');
            printInfo('minor  - 功能版本 (1.0.0 -> 1.1.0)');
            printInfo('major  - 主要版本 (1.0.0 -> 2.0.0)');
            process.exit(1);
        }

        const versionType = args[0];
        const commitMessage = args[1] || 'Release version';

        // 验证版本类型
        if (!['patch', 'minor', 'major'].includes(versionType)) {
            printError('版本类型必须是: patch, minor, 或 major');
            process.exit(1);
        }

        // 检查是否在 git 仓库中
        const gitCheck = execCommand('git rev-parse --git-dir', { silent: true });
        if (!gitCheck.success) {
            printError('当前目录不是 git 仓库');
            process.exit(1);
        }

        // 检查工作区是否干净
        const statusCheck = execCommand('git diff-index --quiet HEAD --', { silent: true });
        if (!statusCheck.success) {
            printError('工作区有未提交的更改，请先提交或暂存');
            execCommand('git status --porcelain');
            process.exit(1);
        }

        // 检查未跟踪的文件
        const untrackedCheck = execCommand('git ls-files --others --exclude-standard', { silent: true });
        if (untrackedCheck.success && untrackedCheck.output.trim()) {
            printWarning('发现未跟踪的文件:');
            console.log(untrackedCheck.output);
            const continueWithUntracked = await getUserConfirmation('是否继续?');
            if (!continueWithUntracked) {
                printInfo('操作已取消');
                process.exit(1);
            }
        }

        // 获取当前分支
        const branchResult = execCommand('git branch --show-current', { silent: true });
        const currentBranch = branchResult.output.trim();
        
        if (currentBranch !== 'main' && currentBranch !== 'master') {
            printWarning(`当前分支是 '${currentBranch}'，建议在 main/master 分支发布`);
            const continueWithBranch = await getUserConfirmation('是否继续?');
            if (!continueWithBranch) {
                printInfo('操作已取消');
                process.exit(1);
            }
        }

        // 拉取最新代码
        printInfo('拉取最新代码...');
        const pullResult = execCommand(`git pull --no-rebase origin ${currentBranch}`);
        if (!pullResult.success) {
            printError('拉取代码失败');
            process.exit(1);
        }

        // 获取当前版本
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const currentVersion = packageJson.version;
        printInfo(`当前版本: ${currentVersion}`);

        // 计算新版本号
        const newVersion = calculateNewVersion(currentVersion, versionType);
        printInfo(`新版本: ${newVersion}`);

        // 确认发布
        console.log('\n' + colors.yellow + '[WARNING]' + colors.reset + ' 即将执行以下操作:');
        console.log(`  1. 更新 package.json 版本号: ${currentVersion} -> ${newVersion}`);
        console.log('  2. 运行构建命令');
        console.log(`  3. 提交更改: '${commitMessage}'`);
        console.log(`  4. 创建标签: v${newVersion}`);
        console.log('  5. 推送到远程仓库');
        console.log('');

        const confirmRelease = await getUserConfirmation('确认继续?');
        if (!confirmRelease) {
            printInfo('操作已取消');
            process.exit(1);
        }

        // 更新版本号
        printInfo('更新 package.json 版本号...');
        updatePackageVersion(newVersion);
        
        // 验证版本号更新
        const updatedPackageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        if (updatedPackageJson.version !== newVersion) {
            printError('版本号更新失败');
            process.exit(1);
        }
        printSuccess(`版本号已更新: ${newVersion}`);

        // 运行构建
        printInfo('运行构建...');
        const buildResult = execCommand('bun run build');
        if (!buildResult.success) {
            printError('构建失败');
            process.exit(1);
        }
        printSuccess('构建完成');

        // 运行测试（如果存在）
        const testCheck = execCommand('bun run test --dry-run', { silent: true });
        if (testCheck.success) {
            printInfo('运行测试...');
            const testResult = execCommand('bun run test');
            if (!testResult.success) {
                printError('测试失败');
                process.exit(1);
            }
            printSuccess('测试通过');
        } else {
            printWarning('未找到测试脚本，跳过测试');
        }

        // 添加更改到 git
        printInfo('添加更改到 git...');
        execCommand('git add package.json');

        // 检查是否有文件需要提交
        const diffResult = execCommand('git diff --cached --name-only', { silent: true });
        if (diffResult.success && diffResult.output.trim()) {
            printInfo('将要提交的文件:');
            diffResult.output.trim().split('\n').forEach(file => {
                console.log(`  ${file}`);
            });
        } else {
            printWarning('没有文件需要提交');
        }

        // 创建提交
        const fullCommitMessage = `${commitMessage}\n\n- Bump version to ${newVersion}`;
        printInfo('创建提交...');
        const commitResult = execCommand(`git commit -m "${fullCommitMessage}"`);
        if (!commitResult.success) {
            printError('创建提交失败');
            process.exit(1);
        }

        // 创建标签
        const tagName = `v${newVersion}`;
        printInfo(`创建标签: ${tagName}`);
        const tagResult = execCommand(`git tag -a "${tagName}" -m "Release ${newVersion}"`);
        if (!tagResult.success) {
            printError('创建标签失败');
            process.exit(1);
        }

        // 推送到远程
        printInfo('推送到远程仓库...');
        const pushResult = execCommand(`git push origin ${currentBranch}`);
        if (!pushResult.success) {
            printError('推送分支失败');
            process.exit(1);
        }

        const pushTagResult = execCommand(`git push origin ${tagName}`);
        if (!pushTagResult.success) {
            printError('推送标签失败');
            process.exit(1);
        }

        printSuccess('发布完成!');
        printInfo(`版本: ${newVersion}`);
        printInfo(`标签: ${tagName}`);
        printInfo(`分支: ${currentBranch}`);

        // 显示最近的提交和标签
        console.log('');
        printInfo('最近的提交:');
        execCommand('git log --oneline -3');

        console.log('');
        printInfo('最近的标签:');
        execCommand('git tag --sort=-version:refname | head -5');

        console.log('');
        printSuccess(`🎉 版本 ${newVersion} 发布成功!`);

    } catch (error) {
        printError(`发布失败: ${error.message}`);
        process.exit(1);
    }
}

// 运行主函数
if (require.main === module) {
    main().catch(error => {
        printError(`未处理的错误: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    calculateNewVersion,
    updatePackageVersion
};