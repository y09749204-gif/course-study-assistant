const C=require('../../src/core.js');
const profile={name:'模拟课程',url:'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=mock-course-alpha',courseId:'mock-course-alpha',minLessons:2,minMinutes:25,report:{courseId:'111',recruitId:'222',url:'https://stuonline.zhihuishu.com/stuonline/stuLearnReportNew/index?recruitId=222&courseId=111'}};
const core=C.create(profile);
module.exports={...core,profile};
