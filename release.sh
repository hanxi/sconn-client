#!/bin/bash

# 版本发布脚本
# 用法: ./release.sh [patch|minor|major] [commit_message]
# 示例: ./release.sh patch "修复连接重试逻辑"
# 示例: ./release.sh minor "添加新的API接口"
# 示例: ./release.sh major "重构核心架构"

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查参数
if [ $# -lt 1 ]; then
    print_error "用法: $0 [patch|minor|major] [commit_message]"
    print_info "patch  - 修复版本 (1.0.0 -> 1.0.1)"
    print_info "minor  - 功能版本 (1.0.0 -> 1.1.0)"
    print_info "major  - 主要版本 (1.0.0 -> 2.0.0)"
    exit 1
fi

VERSION_TYPE=$1
COMMIT_MESSAGE=${2:-"Release version"}

# 验证版本类型
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
    print_error "版本类型必须是: patch, minor, 或 major"
    exit 1
fi

# 检查是否在 git 仓库中
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "当前目录不是 git 仓库"
    exit 1
fi

# 检查工作区是否干净
if ! git diff-index --quiet HEAD --; then
    print_error "工作区有未提交的更改，请先提交或暂存"
    git status --porcelain
    exit 1
fi

# 检查是否有未跟踪的文件
if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    print_warning "发现未跟踪的文件:"
    git ls-files --others --exclude-standard
    read -p "是否继续? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "操作已取消"
        exit 1
    fi
fi

# 确保在主分支
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
    print_warning "当前分支是 '$CURRENT_BRANCH'，建议在 main/master 分支发布"
    read -p "是否继续? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "操作已取消"
        exit 1
    fi
fi

# 拉取最新代码
print_info "拉取最新代码..."
git pull --no-rebase origin $CURRENT_BRANCH

# 获取当前版本
CURRENT_VERSION=$(bun -p "require('./package.json').version")
print_info "当前版本: $CURRENT_VERSION"

# 计算新版本号
calculate_new_version() {
    local current=$1
    local type=$2
    
    # 分割版本号
    IFS='.' read -ra VERSION_PARTS <<< "$current"
    local major=${VERSION_PARTS[0]}
    local minor=${VERSION_PARTS[1]}
    local patch=${VERSION_PARTS[2]}
    
    case $type in
        "patch")
            patch=$((patch + 1))
            ;;
        "minor")
            minor=$((minor + 1))
            patch=0
            ;;
        "major")
            major=$((major + 1))
            minor=0
            patch=0
            ;;
    esac
    
    echo "$major.$minor.$patch"
}

NEW_VERSION=$(calculate_new_version $CURRENT_VERSION $VERSION_TYPE)
print_info "新版本: $NEW_VERSION"

# 确认发布
echo
print_warning "即将执行以下操作:"
echo "  1. 更新 package.json 版本号: $CURRENT_VERSION -> $NEW_VERSION"
echo "  2. 运行构建命令"
echo "  3. 提交更改: '$COMMIT_MESSAGE'"
echo "  4. 创建标签: v$NEW_VERSION"
echo "  5. 推送到远程仓库"
echo
read -p "确认继续? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_info "操作已取消"
    exit 1
fi

# 更新 package.json 版本号
print_info "更新 package.json 版本号..."
if command -v jq > /dev/null; then
    # 使用 jq 更新版本号（如果可用）
    jq ".version = \"$NEW_VERSION\"" package.json > package.json.tmp && mv package.json.tmp package.json
else
    # 使用 sed 更新版本号
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    else
        # Linux
        sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    fi
fi

# 验证版本号更新
UPDATED_VERSION=$(bun -p "require('./package.json').version")
if [ "$UPDATED_VERSION" != "$NEW_VERSION" ]; then
    print_error "版本号更新失败"
    exit 1
fi

print_success "版本号已更新: $UPDATED_VERSION"

# 运行构建
print_info "运行构建..."
if bun run build; then
    print_success "构建完成"
else
    print_error "构建失败"
    exit 1
fi

# 运行测试（如果存在）
if bun run test > /dev/null 2>&1; then
    print_info "运行测试..."
    if bun run test; then
        print_success "测试通过"
    else
        print_error "测试失败"
        exit 1
    fi
else
    print_warning "未找到测试脚本，跳过测试"
fi

# 添加更改到 git
print_info "添加更改到 git..."
git add package.json dist/

# 检查是否有其他需要提交的文件
if [ -n "$(git diff --cached --name-only)" ]; then
    print_info "将要提交的文件:"
    git diff --cached --name-only | sed 's/^/  /'
else
    print_warning "没有文件需要提交"
fi

# 创建提交
FULL_COMMIT_MESSAGE="$COMMIT_MESSAGE

- Bump version to $NEW_VERSION"

print_info "创建提交..."
git commit -m "$FULL_COMMIT_MESSAGE"

# 创建标签
TAG_NAME="v$NEW_VERSION"
print_info "创建标签: $TAG_NAME"
git tag -a "$TAG_NAME" -m "Release $NEW_VERSION"

# 推送到远程
print_info "推送到远程仓库..."
git push origin $CURRENT_BRANCH
git push origin $TAG_NAME

print_success "发布完成!"
print_info "版本: $NEW_VERSION"
print_info "标签: $TAG_NAME"
print_info "分支: $CURRENT_BRANCH"

# 显示最近的提交和标签
echo
print_info "最近的提交:"
git log --oneline -3

echo
print_info "最近的标签:"
git tag --sort=-version:refname | head -5

echo
print_success "🎉 版本 $NEW_VERSION 发布成功!"